# FedEx adapter (FedEx REST APIs, OAuth 2.0)

Documentation capture for TASK-009 (SPK-02). Nothing here was produced by calling a FedEx endpoint: no credentials exist (D-003) and the platform runs on the Mock carrier. The FedEx developer portal renders its guides as readable prose but serves the OpenAPI definitions, endpoint paths and field tables client-side, so **the paths and most field names could not be machine-read on 2026-11-12**. Each item is marked **confirmed** (read on a FedEx page), **confirmed (secondary)** (third-party source that quotes it), or **unverified**. Fixtures written from this are **synthesised** until a live sandbox run (`CARRIER_LIVE_SANDBOX=1`, COND-SANDBOX-DEMO) confirms them.

| Field | Value |
|---|---|
| Docs URL | https://developer.fedex.com/api/en-us/catalog.html (per-API pages `catalog/<api>/v1/docs.html`) |
| API version | Catalog entries are `v1` for Authorization, Rate, Ship, Pickup, Track, Address Validation and Ground End of Day Close (page URLs `…/catalog/rate/v1/…`, `…/ship/v1/…`, `…/pickup/v1/…`, `…/track/v1/…`, `…/address-validation/v1/…`, `…/close/v1/…`). A portal search snippet labels Rates and Transit Times "1.0.0" (last updated 2020-07-27 on the catalog card). The API exposes **no version header**; the version is the path segment |
| Date checked | 2026-11-12 |
| Verdict | **FALLBACK for paths and field names** of Rate, Ship, Cancel, Pickup, Address Validation and Locations (portal specs unreadable); **GO** for OAuth, rate limits, error handling, the virtualized sandbox and the ETD upload flow. Operations stay "unverified" and live sandbox stays opt-in (PLAN.md SPK-02 fallback) |
| Sandbox quirks | See [Sandbox quirks](#sandbox-quirks) |

## 1. Environments and authentication

| Item | Value | Source |
|---|---|---|
| Sandbox ("test") base URL | `https://apis-sandbox.fedex.com` | F2, F3 |
| Production base URL | `https://apis.fedex.com` | F2, F3 |
| Token endpoint | `POST /oauth/token` on the same host. Body `application/x-www-form-urlencoded` | F1 |
| Grant types | `client_credentials` (standard), `csp_credentials` (compatible/integrator), `client_pc_credentials` (proprietary parent-child) | F1 |
| Body fields | Always: `grant_type`, `client_id` (project API key), `client_secret` (project secret). For `csp_credentials` and `client_pc_credentials` additionally `child_key` and `child_secret` (the prose says `child_id`; the examples use `child_key`: treat `child_key` as authoritative, unverified). Placeholders in tests: `<FEDEX_API_KEY>`, `<FEDEX_SECRET_KEY>` | F1 |
| Token response | `access_token`, `token_type` = `bearer`, **`expires_in` = 3600**, `scope` (example `CXS`). The page says the token "must be regenerated after 60 minutes" | F1, F3 |
| API call authentication | `Authorization: Bearer <access_token>` | F1 |
| Token caching | Cache and reuse until expiry; request a new token **only when a 401 is observed**; keep tokens on the server. Matches ADR-0010 `TokenCache` (expiry minus 60 s, drop on 401, one retry) | F3 |
| Token-service throttling (per public IP) | Burst: 3 requests per second sustained over 5 seconds; average: 1 per second sustained over 2 minutes. A violation triggers a 10-minute penalty during which every request gets `403 Forbidden`; continued violations extend it. Therefore: single in-flight refresh per account, never a token per call | F4 |
| Other headers | `Content-Type: application/json` on APIs; `x-customer-transaction-id` (correlation) and `x-locale` are commonly sent in FedEx integrations but are **unverified** here (the best-practices page does not mention them). Send the correlation id as `x-customer-transaction-id` as a harmless extra |  |

Sandbox and production credentials are separate: model them as separate carrier accounts (brief Appendix B, ADR-0010). Third-party (CSP/integrator) credentials are ADR-0011's concern.

## 2. Error model and rate limits

| Item | Value | Source |
|---|---|---|
| HTTP statuses | 200 success (parse notes and warnings), 400 bad request, 401 credentials not authenticated, 403 not authorized, 404 resource gone, 405 wrong method, 409 conflict, 415 unsupported media type, 422 understood but not processable, 429 too many requests, 500 unexpected FedEx error, 503 unavailable | F3 |
| Guidance | "Code only to error codes and not error messages since messages are subject to change dynamically": map by `code`, never by message | F3 |
| Error body | An `errors[]` array with `code` and `message` (inferred from an SDK that rejects on non-empty `errors[]`; the portal pages read do not show the schema: **unverified field names**). **A 200 response can carry a non-empty `errors[]`**, so check it on success (F5). Validate Shipment returns errors, warnings, notes and alerts | F3, F5, F6 |
| Per-project rate limit | **1,400 transactions per 10 seconds** (one best-practices locale version says 750: use configuration, default 1,400 per the en-us rate-limit guide) | F4 |
| Throttle responses | `429` "Rate limit threshold exceeded. Retry after 10 seconds." or "We have received too many requests in a short duration"; the rest of the 10-second window is throttled | F4 |
| Daily quota | Per organisation (example 500,000 requests a day) and per project per capability (Track default 100K a day for all six Track endpoints). Exceeding it: `429` "Daily transaction quota exceeded. Retry after 12:00AM GMT". Sandbox and production quotas are not separated on the page | F4 |
| Test hygiene | Do not run performance tests in the sandbox or production | F3 |
| Retry | Per ADR-0010 (429/502/503/504, idempotent operations only, base 200 ms). Honour the 10-second window by treating 429 as `CARRIER_BUSY`-class local backoff rather than three quick retries |  |

## 3. Operations

### 3.1 Rate (`getRates`)

| Item | Value |
|---|---|
| Method and path | `POST /rate/v1/rates/quotes`, **confirmed (secondary)**: brief Appendix B ("seen in current integrations") and a FedEx duties-and-taxes guide listing "Rate and Transit Times (rate/v1/rates/quotes)" (via search result, the PDF itself returned access denied to the fetcher). Not read from the portal OpenAPI. `/rate/v1/comprehensiverates/quotes` is a **different** API (Comprehensive Rates, incl. One Rate) |
| Request fields | The portal prose names: account number (required), origin and destination details, `serviceType` (to request one service), `packagingType` (for example `FEDEX_ENVELOPE`, `FEDEX_PAK`, `FEDEX_TUBE`, `FEDEX_SMALL_BOX`), `rateRequestType` (LIST, ACCOUNT-specific), package weight and length/width/height, `returnTransitTimes`, `processingOptions` (`INCLUDE_PICKUPRATES`), `requestType` (`FUTURE_DAY`), `pickupDetail.readyDate`/`latestPickupDate`, `carrierCode`, `rateSortOrder`. Conventional JSON shape (`accountNumber.value`, `requestedShipment.shipper.address`, `recipient.address`, `pickupType`, `requestedPackageLineItems[]`) is **unverified** |
| Response | Names in prose: rate reply per service with service codes/types, packaging type and commitment (transit) details; rate types `LIST`, `PREFERRED`, `INCENTIVE`, `ACCOUNT`; total surcharges, total taxes (Canadian origin) and itemised surcharges; transit days and delivery dates for Express, Ground and Home Delivery. Conventional path `output.rateReplyDetails[].ratedShipmentDetails[]` with `totalNetCharge`: **unverified** |
| Documented behaviours | "All rate quotes are estimates only and may differ from the actual invoiced amount." Only the whole-number part of dimensions is used (9.4 becomes 9; round up before sending to match the invoice). "A rate request does not return route." The API does not validate service availability for the ship date or lane. **Freight services are not quoted.** |
| Retry | Yes |
| Source | F7 (Rate API documentation page) |

### 3.2 Ship (`createShipment`) and labels

| Item | Value |
|---|---|
| Method and path | `POST /ship/v1/shipments`: **confirmed (secondary)** by brief Appendix B only; **unverified** on the portal (the Ship page names operations but not paths) |
| Operations named on the Ship page | Create Shipment, Validate Shipment (HTTP 200 plus a transaction id, with errors/warnings/notes/alerts), Retrieve Async Ship (`jobId` and `accountNumber`), Cancel Shipment, Create Tag, Cancel Tag |
| Request fields | Prose names: `accountNumber`, pickup type, service type, packaging type, shipper and recipient information, payment type and payer, package weights, `processingOptions`, `pickupDetail`, `shipper.tins[]` (for example IOSS numbers), `requestedShipment.customsClearanceDetail.commodities[].regulatoryDetails[]` (`regulationCode`, `productId`, `productIdType`, `details`). Label options: `labelResponseOptions` (`URL_ONLY` confirmed by a third-party SDK example; `LABEL` unverified), `labelSpecification` (image type, printer format, stock): values such as `PDF`, `PNG`, `ZPLII` and stock types are **unverified** |
| Response | Prose: tracking number and label information. Conventional `output.transactionShipments[].masterTrackingNumber`, `pieceResponses[]`, `packageDocuments[]` (`encodedLabel` or `url`): **unverified** |
| Idempotency | No client-reference de-duplication confirmed. Declare `idempotent create = false` (ambiguous create leads to `EXCEPTION`) |
| Retry | Never (ADR-0010) |
| Source | F8 (Ship API documentation page, first 100,000 of 177,634 characters read), F5 |

### 3.3 Cancel shipment (`cancelShipment`)

`PUT /ship/v1/shipments/cancel`: the path is **confirmed (secondary)** by a Microsoft connector page quoted in a search result (it says the endpoint cancels Express and Ground shipments not yet tendered to FedEx and cancels all packages), the method `PUT` is **unverified**. FedEx's Ship page says Cancel Shipment applies to created shipments/packages that have been tendered; the sources conflict on the tendered condition (**open question**). Response: an indicator and a message (prose only). Retry: yes (idempotent per ADR-0010).

### 3.4 Track (`track`)

| Item | Value |
|---|---|
| Method and path | `POST /track/v1/trackingnumbers`: **confirmed (secondary)** (search result describing the tracking-number lookup, plus brief Appendix B). Other Basic Integrated Visibility operations: by reference, by TCN (1 per request), multiple-piece shipment, documents (SPOD, bill of lading, freight billing: PDF or PNG), send notifications, batch tracking |
| Limits | **Maximum 30 tracking numbers per request** (portal prose). Reference tracking without an account number needs ship date (plus or minus 15 days), destination country and postal code |
| Request fields | Prose: tracking numbers, detailed-scans flag, reference type (`BILL OF LADING`, `CUSTOMER_REFERENCE`, `INVOICE`, `PURCHASE_ORDER`) and account number, TCN, master tracking number with identifier type `STANDARD_MPS`. Conventional `trackingInfo[].trackingNumberInfo.trackingNumber`, `includeDetailedScans`: **unverified** |
| Response | `output.completeTrackResults[].trackResults[]` (confirmed in prose), `scanEvents[].delayDetail.status` (`ON_TIME`, `EARLY`, `DELAYED`) with delay type and subtype (for example weather), `estimatedDeliveryTimeWindow.window.begins`/`ends`; notifications at reply, completed-detail and per-tracking-number level. Status fields `latestStatusDetail`, `dateAndTimes`: **unverified** |
| Errors | Authenticated Delivery shipments return `TRACKING.AUTHENTICATEDDELIVERY.ERROR` ("only supports secured tracking flows"). A failure at reply level or request level means ignore the rest of the payload. Other codes not read |
| Push | No webhook is documented; notifications are e-mail only. `capabilities().pushTracking = false` |
| Quota | Track default 100K requests a day per project (section 2) |
| Retry | Yes |
| Source | F9 |

### 3.5 Pickup (`schedulePickup`, `cancelPickup`)

| Item | Value |
|---|---|
| Method and path | `POST /pickup/v1/pickups` (create) and `PUT /pickup/v1/pickups/cancel` (cancel): both **unverified** (paths from ADR-0010's re-verify list; the portal page does not show them). Check availability is a separate operation (path unverified) |
| Create inputs (prose) | Account number invoiced, origin address and location and pickup address type (account, shipper, other), carrier (Express or Ground), ready time and latest pickup/company close time, country relationships for cross-border pickups, package weight unit LB or KG (must match the commodity unit) |
| Create response (prose) | Pickup confirmation number, notification, location code (Express only) |
| Cancel inputs | Pickup confirmation code, carrier, scheduled date, location code (Express only); response a confirmation number and message |
| Rules | Express: ready time no later than the postal-code cutoff, gap to closing at least the **access time** returned by availability (for example `PT4H0M`), current or next business day. Ground: next business day up to 2 weeks ahead. Cancel: Express same day, Ground within 24 hours of submission, and only before the ready time and before a courier is dispatched. No in-place changes: cancel and resubmit. At most one dispatch request per day unless more packages exceed the first request's size |
| Retry | Create never, cancel yes (ADR-0010) |
| Source | F10 |

### 3.6 Address validation (optional `validateAddress`)

Catalog API `address-validation/v1` (confirmed by a third-party SDK's documentation links); path `POST /address/v1/addresses/resolve` is **unverified** (ADR-0010 re-verify item; no source found). Address Validation is **virtualized** in the sandbox, and it is not part of the virtualized rate logic (the rate sandbox validates only the country). Source F6, F5.

### 3.7 Locations / service points (optional `findServicePoints`)

"FedEx Location Search" is listed as a virtualized sandbox API (F6). Path, version and fields: **unverified** (not read).

### 3.8 Trade documents upload / ETD (optional `uploadCustomsDocuments`)

| Item | Value |
|---|---|
| Method and path | `POST /documents/v1/etds/upload`, `multipart/form-data` with the document as an attachment: **confirmed (secondary)** from FedEx's ETD quick guide as quoted in search results (PDF returned access denied to the fetcher) |
| Hosts | **Different from the main API:** sandbox `https://documentapitest.prod.fedex.com/sandbox`, production `https://documentapi.prod.fedex.com` (the same quick guide). Add both to the per-environment host allow-list (ADR-0016) only when the ETD operation is implemented |
| Workflow | `workflowName` = `ETDPreShipment` (before ship) or `ETDPostShipment` (after); up to five documents per request. The returned `documentId` goes into the ship request special services (`etdDetail`) |
| Quality of evidence | Secondary, unverified against the portal page (`catalog/upload-documents/v1/docs.html`, not read) |

### 3.9 Landed cost / duties and taxes

FedEx has an estimated duties and taxes feature (guide `fedex-api-estimated-duties-taxes`, access denied to the fetcher) tied to the Rate API's customs data. No separate landed-cost endpoint was confirmed: `estimateLandedCost` is **unverified** and should be declared unsupported for FedEx (REQ-CARR-003 `CAPABILITY_NOT_SUPPORTED`) unless the Rate API's duties and taxes output is chosen as the source (open question).

## 4. Sandbox quirks

From the sandbox virtualization guide (F6):

- Virtualized sandbox returns **predefined responses** that "do not always vary based on the specific input values you provide": changing addresses in a rate request returns the same reply, values differ from live, structure matches. Keep the request payload **structure** equal to the documented JSON API Collection payload to get the virtualized response.
- Each response includes an alert in the payload identifying it as virtualized (the alert text is an image on the page: unread).
- Negative test cases are prefixed `Negative` in each API's JSON API Collection (this is where error fixtures come from).
- Token generation and authorization work as in production; the token must be passed on every call.
- Virtualized calls skip live backends, so no account-level special-service restrictions apply, and they are faster than the live sandbox.
- Virtualized APIs listed: Rate and Transit Times, Basic Integrated Visibility, Freight LTL Rate and Pickup, Address Validation, Postal Code Validation, Pickup Request, Service Availability, Global Trade, Ground End of Day Close, Open Ship, Ship and FedEx Location Search. Not every capability is virtualized yet.
- Test tracking numbers and scenario triggers: not on the page (in the per-API JSON API Collection).
- Cancel and ETD use the real backend or a different host: **unverified**.

## 5. Sources

| ID | Source | Retrieved | Used for |
|---|---|---|---|
| F1 | https://developer.fedex.com/api/en-us/catalog/authorization/v1/docs.html | 2026-11-12 | OAuth endpoint, grants, fields, `expires_in` 3600 |
| F2 | Brief Appendix B (`shipping-platform-brief.md`) | 2026-11-12 | Hosts; paths seen in integrations |
| F3 | https://developer.fedex.com/api/en-us/guides/best-practices.html | 2026-11-12 | Token reuse on 401, status codes, test and production URLs |
| F4 | https://developer.fedex.com/api/en-us/guides/ratelimits.html | 2026-11-12 | 1,400 per 10 s, quotas, 429 texts, token-service throttle, penalty |
| F5 | https://github.com/stores-com/fedex (third-party SDK README) | 2026-11-12 | Catalog API versions, hosts, `URL_ONLY`, 200 with `errors[]`, `expires_in` 3600 |
| F6 | https://developer.fedex.com/api/en-us/guides/sandboxvirtualization.html | 2026-11-12 | Virtualized sandbox rules and API list |
| F7 | https://developer.fedex.com/api/en-us/catalog/rate/v1/docs.html | 2026-11-12 | Rate behaviours (prose); no paths |
| F8 | https://developer.fedex.com/api/en-us/catalog/ship/v1/docs.html | 2026-11-12 | Ship operations (prose); no paths |
| F9 | https://developer.fedex.com/api/en-us/catalog/track/v1/docs.html | 2026-11-12 | Track operations, 30-number limit (prose); no paths |
| F10 | https://developer.fedex.com/api/en-us/catalog/pickup/v1/docs.html | 2026-11-12 | Pickup rules (prose); no paths |
| F11 | Search results (not page reads): developer.fedex.com `catalog/rate.html` card, FedEx duties-and-taxes PDF, FedEx ETD quick guide PDF `fedex-api-etd-quickguide-en-apac.pdf`, Microsoft FedEx connector page, FedEx track page description | 2026-11-12 | Secondary confirmation of `rate/v1/rates/quotes`, `track/v1/trackingnumbers`, `ship/v1/shipments/cancel`, ETD upload path and hosts. The fedex.com PDFs and the Microsoft Learn page were **not** readable when fetched directly (access denied / 404) |

## 6. ADR-0010 re-verify items: result

| Item | Result |
|---|---|
| OAuth `POST /oauth/token`, grants, `expires_in` 3600 | **Confirmed** (F1) |
| Hosts `apis-sandbox.fedex.com` / `apis.fedex.com` | **Confirmed** (F3, F5) |
| `/rate/v1/rates/quotes` | **Confirmed (secondary)** |
| `/ship/v1/shipments` | Brief only; **unverified** |
| `PUT /ship/v1/shipments/cancel` | Path **confirmed (secondary)**, method **unverified** |
| `/track/v1/trackingnumbers` | **Confirmed (secondary)** (`POST`) |
| `/pickup/v1/pickups`, `/pickup/v1/pickups/cancel` | **Unverified** |
| `/address/v1/addresses/resolve` | **Unverified** |
| ETD upload | Path and distinct hosts **confirmed (secondary)** |
| Rate API notes (estimates, truncated decimals) | **Confirmed** (F7) |

## 7. Open questions

1. A person with portal access should download each API's OpenAPI definition and the "JSON API Collection" and diff the paths, methods and field names above (blocks TASK-139 closing the contract, not starting).
2. Methods and bodies of cancel shipment, create pickup, cancel pickup, address resolve and location search.
3. Label formats and `labelSpecification` values (`PDF`, `PNG`, `ZPLII`), stock types, and `LABEL` vs `URL_ONLY` handling.
4. Whether a tendered shipment can be cancelled (conflicting sources).
5. Error body schema (`errors[].code`, `message`) and the most common error codes per API.
6. Sandbox test tracking numbers and scenario triggers (JSON API Collection).
7. India lane: required customs data and whether ETD is mandatory for US to IN.
8. Duties and taxes: use the Rate API output or no landed cost.
9. Whether the sandbox quota differs from production (the guide does not separate them).
10. FedEx Freight is a separate API family and OAuth server and out of scope.

## 8. Fixture plan per operation

Names only. All fixtures are **synthesised** (labelled `"_fixture": "synthesised"`), contain placeholders such as `<FEDEX_TRACKING_NUMBER>` and `<ACCOUNT_NUMBER>`, and no real names, addresses, phone numbers or tokens. Where possible, structure them from the portal's JSON API Collection payloads. Layout and file names are decided by TASK-139.

| Operation | Success | Typical errors | Edge cases |
|---|---|---|---|
| `oauth-token` | `token-success-3600`, `token-success-csp` | `token-401-bad-credentials`, `token-403-ip-penalty`, `token-429`, `token-500` | `token-expiry-minus-60s-refresh`, `token-401-on-api-call-then-refresh-once`, `token-concurrent-refresh-single-flight` |
| `rate` | `rate-us-in-express-ground`, `rate-list-and-account-rates`, `rate-returntransittimes` | `rate-400-invalid-postal`, `rate-401-expired-token`, `rate-403`, `rate-422-service-unavailable`, `rate-429-window`, `rate-429-daily-quota`, `rate-503` | `rate-200-with-errors-array`, `rate-decimal-dimensions-truncated`, `rate-unmapped-service-type`, `rate-unmapped-surcharge`, `rate-no-freight-services`, `rate-multi-package`, `rate-timeout` |
| `ship` | `ship-pdf-label-url-only`, `ship-label-encoded`, `ship-zplii-label`, `ship-international-with-customs`, `ship-with-etd-document-id` | `ship-400-invalid-address`, `ship-401`, `ship-403`, `ship-422-service-not-allowed`, `ship-429`, `ship-500-ambiguous`, `ship-timeout-ambiguous` | `ship-200-with-warnings`, `ship-multi-piece`, `ship-validate-shipment-notes-alerts`, `ship-async-job-pending`, `ship-label-url-expiry` |
| `ship-cancel` | `cancel-success` | `cancel-400-already-cancelled`, `cancel-404-unknown`, `cancel-422-already-tendered` | `cancel-after-pickup-created` |
| `track` | `track-delivered`, `track-in-transit`, `track-out-for-delivery`, `track-label-created`, `track-exception`, `track-returned` | `track-404-not-found`, `track-400-invalid-number`, `track-401`, `track-429`, `track-503`, `track-authenticated-delivery-error` | `track-batch-30-numbers`, `track-partial-not-found-in-batch`, `track-delay-detail-weather`, `track-estimated-window`, `track-multi-piece-mps`, `track-signatory-redaction` |
| `pickup-create` | `pickup-create-express`, `pickup-create-ground` | `pickup-create-400-past-ready-time`, `pickup-create-422-inside-access-time`, `pickup-create-429`, `pickup-create-500-ambiguous` | `pickup-create-remote-area`, `pickup-create-duplicate-same-day` |
| `pickup-cancel` | `pickup-cancel-express-same-day`, `pickup-cancel-ground` | `pickup-cancel-400-after-dispatch`, `pickup-cancel-404-unknown` | `pickup-cancel-ground-over-24h` |
| `address-resolve` (optional) | `address-resolved`, `address-resolved-residential` | `address-400-bad-country` | `address-ambiguous`, `address-unresolved` |
| `locations` (optional) | `locations-by-postal` | `locations-400-invalid` | `locations-empty` |
| `etd-upload` (optional) | `etd-pre-shipment-success`, `etd-post-shipment-success` | `etd-400-too-many-documents`, `etd-400-unsupported-type` | `etd-five-documents` |
