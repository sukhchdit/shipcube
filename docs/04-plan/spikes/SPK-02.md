# SPK-02 — Carrier API documentation capture (DHL Express MyDHL, FedEx REST, UPS REST)

| Field | Value |
|---|---|
| Task | TASK-009 (Wave 0, batch 0.3) · branch `feat/TASK-009-spk-02-spike-carrier-api` |
| Risks | R-ARCH-02, R-PLAN-08 (carrier fixtures drift from real APIs; no sandbox access) |
| Requirements | REQ-CARR-019 (README with docs URL, API version, date checked, sandbox quirks), REQ-CARR-020 (live sandbox opt-in), brief §13 rule 6, Appendix B |
| Date / method | 2026-11-12 · public documentation only (WebFetch, WebSearch, `curl` of public GitHub raw files). **No carrier API host was called**; no credentials, accounts or personal data were used. GitHub sources are pinned to the commit read (UPS-API/api-documentation `fd57ca9`, sonnenglas/mydhl-php-sdk `50edb9b`, stores-com/fedex `7134d2e`, each the default-branch head on 2026-11-12); web pages are pinned by retrieval date (2026-11-12) |
| Owner | backend-developer |
| Deliverables | `packages/carriers/src/adapters/{ups,dhl-express,fedex}/README.md`, this record |
| **Verdict** | **UPS: GO.** **FedEx: FALLBACK** for named operations (Pickup and Locations paths, and the field names of every operation; the Rate, Ship, Cancel, Track and Address Validation paths and methods are only secondarily confirmed, by the third-party SDK F5 `index.js` @ `7134d2e`). **DHL Express: FALLBACK** for named operations (official spec unreadable; paths confirmed only from a third-party SDK; `cancelShipment` not found). Overall: **FALLBACK for the named operations**, which triggers the ADR-0010 amendment request in §4 before TASK-135 (DHL), TASK-139 (FedEx) and TASK-140 (UPS) start; the adapter tasks can start from the READMEs with fixtures synthesised and flagged |

Verdict meaning (WAVE-00 DoD): GO = enough confirmed for fixture-backed adapters; FALLBACK = the PLAN.md §9 fallback applies to the named operations ("mark operations unverified and keep live sandbox opt-in, COND-SANDBOX-DEMO").

## 1. Evidence summary per carrier

| | UPS | FedEx | DHL Express |
|---|---|---|---|
| Version(s) confirmed | Rating, Ship, Void, Pickup `v2409`; Tracking `v1`; Address Validation `v2`; Locator `v3`; Paperless `v2`; Landed Cost `v1`; Label Recovery `v1`; OAuth `v1` | Catalog `v1` for Authorization, Rate, Ship, Pickup, Track, Address Validation, Close (page URLs). No version header | Spec line 3.3.x; `x-version: 3.3.1` per the SDK (unverified against DHL) |
| Source quality | Official OpenAPI YAML (GitHub `UPS-API/api-documentation` @ `fd57ca9`), read in full for 9 APIs | Official portal prose pages and guides (specs not machine-readable); third-party SDK source F5 @ `7134d2e`; search snippets of official PDFs | Third-party SDK source (MIT, spec 3.3.1) @ `50edb9b`; official portal blocked by a WAF |
| OAuth / auth | Confirmed: `POST /security/v1/oauth/token`, Basic client credentials, form body | Confirmed: `POST /oauth/token`, form body, `expires_in` (example 3600, read per response), 401 → refresh | Basic (key and secret) + account number; no token |
| Token lifetime | Spec silent; third party says 1 h from 2026-04-01 (unverified) | 3600 s in the official example, confirmed; read `expires_in` per response | none |
| Rate | Confirmed `POST /rating/v2409/{Rate\|Shop\|Ratetimeintransit\|Shoptimeintransit}` | Path and method confirmed (secondary) `POST /rate/v1/rates/quotes` (F5 `index.js` L213-216); fields unverified | Confirmed (secondary) `GET /rates`, `POST /rates`, `GET /products` |
| Ship + labels | Confirmed `POST /shipments/v2409/ship`; Ship labels GIF, ZPL, EPL, SPL (**no PDF on Ship**); **PDF documented on Label Recovery** (`Shipping.yaml` L13479-13500) | Path and method confirmed (secondary) `POST /ship/v1/shipments` (F5 `index.js` L80-83); `URL_ONLY` seen (not to be used) | Confirmed (secondary) `POST /shipments`; `pdf`, `zpl`, `lp2`, `epl` |
| Cancel shipment | Confirmed `DELETE /shipments/v2409/void/cancel/{id}` | Path and method confirmed (secondary) `PUT /ship/v1/shipments/cancel` (F5 `index.js` L35-38) | **Not found** (probably unsupported) |
| Track | Confirmed `GET /track/v1/details/{n}`; 1 number per call | Path and method confirmed (secondary) `POST /track/v1/trackingnumbers` (F5 `index.js` L258-261); 30 numbers per call (portal) | Confirmed (secondary) `GET /shipments/{n}/tracking`, `GET /tracking` (200 per batch) |
| Pickup create / cancel | Confirmed `POST /pickupcreation/v2409/pickup`, `DELETE /shipments/v2409/pickup/{CancelBy}` | Paths unverified; rules documented | Confirmed (secondary) `POST /pickups`, `DELETE /pickups/{n}` |
| Optional ops | Address validation, Locator, Paperless, Landed Cost: paths and versions confirmed | Address validation path and method confirmed (secondary) `POST /address/v1/addresses/resolve` (F5 `index.js` L303-306); Locations path unverified; ETD upload path and hosts confirmed (secondary, search snippet F11c) | Address validate, service points, landed cost, upload-image (needs `WY`, ≥ 10 min after create): confirmed (secondary) |
| Rate limits | Not in specs | 1,400 per 10 s per project, daily quotas, token service 3/s burst; confirmed | Sandbox 500 per day per credential set (two sources) |
| Sources | 12 (S1–S11 plus S9b) | 15 (F1–F10, F11a–F11e) | 6 (D1–D3, D4a, D4b, D5) |

## 2. Corrections to ADR-0010 ("confirmed today" table)

1. **UPS void is `DELETE`**, not an unspecified method; `trackingnumber` is a query parameter; `v3` applies to Roadie only.
2. **UPS label recovery exists**: `POST /labels/{version}/recovery` (default `v1`).
3. **UPS Address Validation is `v2`, Locator `v3`** (the earlier `v1` of each is deprecated), Paperless `v2`, Landed Cost `v1`.
4. **UPS PDF labels are not documented for Ship; they are documented for Label Recovery.** `ShipmentRequest` `LabelImageFormat.Code` lists GIF, ZPL, EPL, SPL only (`Shipping.yaml` L11251-11268 @ `fd57ca9`); `LabelRecoveryRequest` `LabelImageFormat.Code` lists GIF, **PDF**, ZPL, EPL, SPL (`Shipping.yaml` L13479-13500 @ `fd57ca9`). How the Platform gets the REQ-DOC-002 PDF label for UPS is the §4 item 3 decision.
5. **UPS token response values are strings** (`expires_in`, `issued_at`). The token host path is `/security/v1/oauth/token` **without** the `/api` prefix that applies to all other operations.
6. **UPS token lifetime**: ADR-0010 left it open. The spec is silent; a third-party notice reports 4 h reduced to 1 h from 2026-04-01. Read `expires_in` per response.
7. **DHL has no confirmed cancel-shipment operation.** ADR-0010's interface lists `cancelShipment` as mandatory.
8. **DHL tracking has two forms** (`GET /shipments/{n}/tracking` single with GMT offsets; `GET /tracking` batch ≤ 200 without per-event GMT offsets). `maxTrackingNumbersPerCall`: UPS 1, FedEx 30, DHL 200.
9. **FedEx paths and methods** `POST /rate/v1/rates/quotes`, `POST /ship/v1/shipments`, `PUT /ship/v1/shipments/cancel`, `POST /track/v1/trackingnumbers` and `POST /address/v1/addresses/resolve` are confirmed (secondary) by the third-party SDK F5 (`stores-com/fedex` `index.js` @ `7134d2e`, lines 213-216, 80-83, 35-38, 258-261 and 303-306), which also sends `x-customer-transaction-id` (line 32); `/pickup/v1/pickups` and `/pickup/v1/pickups/cancel` remain unverified.
10. **FedEx ETD upload uses different hosts** (`documentapitest.prod.fedex.com/sandbox`, `documentapi.prod.fedex.com`; search snippet F11c only); the egress rules (ADR-0016) need them per environment only once the operation is implemented and the hosts are verified on an official page (§4 item 6).
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
2. **`cancelShipment` for DHL**: decide between (a) `CAPABILITY_NOT_SUPPORTED` for DHL (the saga then voids the Platform shipment, cancels the carrier pickup where one exists, and lets the carrier shipment lapse) or (b) keep the operation and prove it in the first live run. Recommended: (a). If cancellation of DHL bookings is promised to users, product-manager must be told. Input for TASK-135 either way: DHL returns the label only inline at create and has neither cancel nor label recovery, so after an ambiguous `createShipment` (timeout or 5xx) a carrier shipment can exist without a stored label and cannot be cancelled. The saga needs a reconciliation step for ambiguous DHL creates (for example a tracking lookup by shipper reference; whether MyDHL supports that lookup is unverified) before it settles on `EXCEPTION`.
3. **UPS PDF labels (REQ-DOC-002).** REQ-DOC-002 reads: "The system shall store each label in every format the selected service offers among PDF 4x6 inches and PDF A4 (non-US/CA origins) or PDF Letter (US/CA origins), and offer the user the format choice on the confirmation page and shipment detail" (note: "If the carrier returns only one format, only that format is offered"). UPS Ship does not document `PDF` (§2 item 4). Neutral option set; **no recommendation, principal-architect decides**:
   - **(a) Ship with `GIF` (or `ZPL`), then Label Recovery requesting `PDF`.** `POST /labels/{version}/recovery` (operation `LabelRecovery`, `Shipping.yaml` L2475-2596 @ `fd57ca9`) with `LabelSpecification.LabelImageFormat.Code = PDF` (schema `LabelRecovery_LabelSpecification_LabelImageFormat`, L13479-13500, "PDF -- label is in PDF format"). Official, but **not exercised in CIE**; one extra transactional call per label (quota, latency, one more failure point after a committed shipment); request by the shipment's tracking identifier only (`TrackingNumber`, schema `LabelRecoveryRequest` L13356-13380; the schema also marks the Roadie-only `TrackingNumbers` and `ReferenceValues` as required, a spec inconsistency to settle in CIE). The PDF page size UPS returns (4x6 or Letter) is unverified.
   - **(b) Decode the GIF and embed it in a PDF in the `documents` module, not the adapter.** pdfkit (a dependency of `apps/worker`, owned by `documents` per ADR-0019) reads JPEG and PNG only (pdfkit 0.20.2 `openImage`, per the PR #6 code review, finding M1), so a GIF decoder is a **new dependency** subject to CLAUDE.md §5/§9 (licence, maintenance, size, justification). Candidate checked on the npm registry on 2026-11-12: `@jimp/js-gif` 1.6.1 (MIT, published 2026-04-07), which depends on `omggif` 1.0.10 (MIT, last published 2019-07-16, outside the 18-month maintenance window) and `gifwrap` 0.10.1 (MIT, 2022). Alternatives: `omggif` directly (same maintenance problem) or an in-house GIF/LZW decoder (CLAUDE.md §5 "implement it in-house"). **This PR adds no dependency.** The adapter would still return GIF bytes; `documents` converts and stores.
   - **(c) Declare UPS labels as `GIF` and `ZPL` only.** UPS then offers no REQ-DOC-002 format, which is a requirement deviation: **product-manager must decide** whether REQ-DOC-002 (a Must) allows a carrier with no PDF label, and record it.
4. **Fixtures labelled `synthesised`** for FedEx and DHL; the contract suite (REQ-CARR-011) must pass against the Mock first, then against the fixtures. TASK-191 (docs-check) should require a "Diffed against official spec by a person: yes/no" line in the FedEx and DHL READMEs; COND-SANDBOX-DEMO remains the closing proof.
5. **Token lifetime configuration**: no hard-coded lifetime; the adapter reads `expires_in` from every response (string in UPS responses; FedEx shows 3600 only as an example) and parses it strictly (TTL = `expires_in` − 60 s, capped by configuration; missing, non-numeric or `≤ 60` means use once, do not cache). **Token failure path** for §Ports `TokenCache` (PR6-SEC-05): token fetches failing with 400/401 are negatively cached per account and count toward the breaker; a FedEx token-endpoint `403` (10-minute per-IP penalty, shared by every account and replica behind the egress) triggers a carrier-wide cool-down with no retries and opens the breaker, and is never treated as a 401-style refresh.
6. **Egress rules per environment (ADR-0016, REQ-SEC-010), replacing a host-only allow-list.** DHL sandbox and production share one host, and the UPS token path is outside `/api`, so each rule is an **exact origin plus path prefix**, bound to `CarrierContext.environment`:

   | Carrier | Operation group | Exact origin (scheme + host) | Path prefix | Environment tier |
   |---|---|---|---|---|
   | UPS | API operations | `https://wwwcie.ups.com` | `/api/` | sandbox |
   | UPS | OAuth token | `https://wwwcie.ups.com` | `/security/v1/oauth/token` (exact path) | sandbox |
   | UPS | API operations | `https://onlinetools.ups.com` | `/api/` | production |
   | UPS | OAuth token | `https://onlinetools.ups.com` | `/security/v1/oauth/token` (exact path) | production |
   | FedEx | OAuth token and API operations | `https://apis-sandbox.fedex.com` | `/` | sandbox |
   | FedEx | OAuth token and API operations | `https://apis.fedex.com` | `/` | production |
   | FedEx | ETD upload (only once implemented and verified) | `https://documentapitest.prod.fedex.com` | `/sandbox/` | sandbox |
   | FedEx | ETD upload (only once implemented and verified) | `https://documentapi.prod.fedex.com` | `/` (unverified; search snippet F11c only) | production |
   | DHL Express | All operations | `https://express.api.dhl.com` | `/mydhlapi/test/` | sandbox |
   | DHL Express | All operations | `https://express.api.dhl.com` | `/mydhlapi/` (excluding `/mydhlapi/test/`) | production |

   Rules:
   - Origins are matched exactly: no wildcards, no suffix matching and no "looks like production" heuristics (the FedEx ETD **sandbox** host contains `prod`). Redirect hops are checked against the same rules.
   - **Production-tier carrier rules are refused unless `APP_ENV=production`**: they exist only in production configuration, and start-up fails when a non-production environment contains one. For DHL, start-up also fails when the sandbox base path does not start with `/mydhlapi/test/`. A test proves a sandbox account never produces a production URL (DHL path prefix included).
   - **ETD rules are added only once the ETD operation is implemented** and its hosts are verified on an official FedEx page.
   - **Carrier-returned URLs are never followed and never surfaced to clients**: UPS `LabelURL`, FedEx `URL_ONLY` label `url`, DHL `trackingUrl` and `cancelPickupUrl`. Label content is fetched only from the API response body (UPS `GraphicImage`, FedEx `LABEL`/`encodedLabel`, DHL `documents[].content`); customer tracking links come from a configured template. The FedEx success fixture `ship-pdf-label-url-only` is replaced by `ship-pdf-label-inline`, and URL_ONLY stays only as the negative case `ship-label-url-only-not-followed` (FedEx README §8).
7. **Quota seeds**: DHL sandbox `CARRIER_DAILY_QUOTA=500` stays (two sources). FedEx and UPS seeds remain `0` (guard off, metered). FedEx documents per-10-second limits (1,400 per 10 s per project) and daily quotas (per organisation, example 500,000 a day; Track 100K a day per project) in F4; the 10-second limit is far above the platform's per-account bulkhead and the daily quotas are left to metering, so the seed-`0` conclusion holds. UPS documents no numbers.
8. **Personal data and secrets per carrier** (PR6-SEC-02/03): each README §3 now has a "Personal data and secrets" subsection (UPS §3.11, FedEx §3.10, DHL §3.11) listing the request-side personal-data, tax-ID and secret field names for the per-carrier redactor deny-list (TASK-188), the identifiers and personal data that go into URL paths and query strings, and data-minimisation flags (no POD or signature images, no remarks views, no label URLs). Requested: the `OutboundHttpClient` (TASK-113) and the ADR-0017 attribute allow-list (TASK-214) record a route template and never the full URL or query string in logs, spans or error text; carrier request and response bodies are never logged; DHL `requestorName` is a fixed non-personal value derived from `BRAND_*` configuration.

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
| No credentials or PII in any file | Yes: only placeholders; example identifiers are public specification examples or placeholders; Gitleaks v8.30.1 run locally on the branch: no leaks; CI lane will re-run |
| No carrier API host contacted | Yes |
