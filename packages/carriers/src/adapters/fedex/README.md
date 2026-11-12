# FedEx adapter (FedEx REST APIs, OAuth 2.0)

Documentation capture for TASK-009 (SPK-02). Nothing here was produced by calling a FedEx endpoint: no credentials exist (D-003) and the platform runs on the Mock carrier. The FedEx developer portal renders its guides as readable prose but serves the OpenAPI definitions, endpoint paths and field tables client-side, so **the paths and most field names could not be machine-read on 2026-11-12**. Each item is marked **confirmed** (read on a FedEx page), **confirmed (secondary)** (third-party source that quotes it), or **unverified**. Fixtures written from this are **synthesised** until a live sandbox run (`CARRIER_LIVE_SANDBOX=1`, COND-SANDBOX-DEMO) confirms them.

| Field | Value |
|---|---|
| Docs URL | https://developer.fedex.com/api/en-us/catalog.html (per-API pages `catalog/<api>/v1/docs.html`) |
| API version | Catalog entries are `v1` for Authorization, Rate, Ship, Pickup, Track, Address Validation and Ground End of Day Close (page URLs `…/catalog/rate/v1/…`, `…/ship/v1/…`, `…/pickup/v1/…`, `…/track/v1/…`, `…/address-validation/v1/…`, `…/close/v1/…`). A portal search snippet labels Rates and Transit Times "1.0.0" (last updated 2020-07-27 on the catalog card, F11a). The API exposes **no version header**; the version is the path segment |
| Date checked | 2026-11-12 |
| Verdict | **FALLBACK for paths and field names** of Rate, Ship, Cancel, Pickup, Address Validation and Locations (portal specs unreadable); **GO** for OAuth, rate limits, error handling, the virtualized sandbox and the ETD upload flow. Operations stay "unverified" and live sandbox stays opt-in (PLAN.md SPK-02 fallback) |
| Sandbox quirks | See [Sandbox quirks](#4-sandbox-quirks) |

## 1. Environments and authentication

| Item | Value | Source |
|---|---|---|
| Sandbox ("test") base URL | `https://apis-sandbox.fedex.com` | F2, F3 |
| Production base URL | `https://apis.fedex.com` | F2, F3 |
| Token endpoint | `POST /oauth/token` on the same host. Body `application/x-www-form-urlencoded` | F1 |
| Grant types | `client_credentials` (standard), `csp_credentials` (compatible/integrator), `client_pc_credentials` (proprietary parent-child) | F1 |
| Body fields | Always: `grant_type`, `client_id` (project API key), `client_secret` (project secret). For `csp_credentials` and `client_pc_credentials` additionally `child_key` and `child_secret` (the prose says `child_id`; the examples use `child_key`: treat `child_key` as authoritative, unverified). Placeholders in tests: `<FEDEX_API_KEY>`, `<FEDEX_SECRET_KEY>`. **The secrets travel in the URL-encoded form body, not in a header**, so JSON-path redaction does not cover them: token requests and responses are excluded from all body logging and raw-payload capture, and `client_secret`, `child_secret` and `access_token` are never logged (TASK-131, TASK-113) | F1 |
| Token response | `access_token`, `token_type` = `bearer`, `expires_in` (the page shows **3600** in its example), `scope` (example `CXS`). The page says the token "must be regenerated after 60 minutes". **Read `expires_in` from every response and never hard-code a lifetime** (SPK-02 §4 item 5): parse it strictly as an integer number of seconds; TTL = `expires_in` − 60 s, capped by configuration; when the value is missing, non-numeric or `≤ 60`, use the token once and do not cache it | F1, F3 |
| API call authentication | `Authorization: Bearer <access_token>` | F1 |
| Token caching | Cache and reuse until expiry; request a new token **only when a 401 is observed on an API call**; keep tokens on the server. Matches ADR-0010 `TokenCache` (expiry minus 60 s, drop on 401, one retry) | F3 |
| Token-service throttling (per public IP) | Burst: 3 requests per second sustained over 5 seconds; average: 1 per second sustained over 2 minutes. A violation triggers a 10-minute penalty during which every request gets `403 Forbidden`; continued violations extend it. Therefore: single in-flight refresh per account, never a token per call. **The limit is per public IP, so it is shared by every FedEx account and every API and worker replica behind the same egress (NAT)**: one account with bad credentials can lock out all FedEx accounts. **A `403` from the token endpoint is not a 401-style refresh**: it stops all FedEx token requests for the penalty window (carrier-wide cool-down, 10 min by configuration), opens the FedEx circuit breaker, makes calls fail fast with `CARRIER_UNAVAILABLE` and raises an operations event; it is never retried. Token fetches failing with 400/401 are negatively cached per account and count toward the breaker (PR6-SEC-05; TASK-131, TASK-132) | F4 |
| Other headers | `Content-Type: application/json` on APIs. `x-customer-transaction-id` (correlation) is **confirmed (secondary)**: the F5 SDK sends it on every API call (`index.js` line 32 @ `7134d2e`); FedEx's best-practices page does not mention it. Send the correlation ID as `x-customer-transaction-id`. `x-locale` is **unverified** | F5 |

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
| Retry | Per ADR-0010 (429/502/503/504, idempotent operations only, base 200 ms). Honour the 10-second window by treating 429 as `CARRIER_BUSY`-class local backoff rather than three quick retries | Design note (derived from F4 and ADR-0010; not a FedEx statement) |

## 3. Operations

### 3.1 Rate (`getRates`)

| Item | Value |
|---|---|
| Method and path | `POST /rate/v1/rates/quotes`, **confirmed (secondary)**: brief Appendix B ("seen in current integrations") and a FedEx duties-and-taxes guide listing "Rate and Transit Times (rate/v1/rates/quotes)" (via search result F11b, the PDF itself returned access denied to the fetcher), and the F5 SDK source (`POST`, `index.js` lines 213-216 @ `7134d2e`). Not read from the portal OpenAPI. `/rate/v1/comprehensiverates/quotes` is a **different** API (Comprehensive Rates, incl. One Rate) |
| Request fields | The portal prose names: account number (required), origin and destination details, `serviceType` (to request one service), `packagingType` (for example `FEDEX_ENVELOPE`, `FEDEX_PAK`, `FEDEX_TUBE`, `FEDEX_SMALL_BOX`), `rateRequestType` (LIST, ACCOUNT-specific), package weight and length/width/height, `returnTransitTimes`, `processingOptions` (`INCLUDE_PICKUPRATES`), `requestType` (`FUTURE_DAY`), `pickupDetail.readyDate`/`latestPickupDate`, `carrierCode`, `rateSortOrder`. Conventional JSON shape (`accountNumber.value`, `requestedShipment.shipper.address`, `recipient.address`, `pickupType`, `requestedPackageLineItems[]`) is **unverified** |
| Response | Names in prose: rate reply per service with service codes/types, packaging type and commitment (transit) details; rate types `LIST`, `PREFERRED`, `INCENTIVE`, `ACCOUNT`; total surcharges, total taxes (Canadian origin) and itemised surcharges; transit days and delivery dates for Express, Ground and Home Delivery. Conventional path `output.rateReplyDetails[].ratedShipmentDetails[]` with `totalNetCharge`: **unverified** |
| Documented behaviours | "All rate quotes are estimates only and may differ from the actual invoiced amount." Only the whole-number part of dimensions is used (9.4 becomes 9; round up before sending to match the invoice). "A rate request does not return route." The API does not validate service availability for the ship date or lane. **Freight services are not quoted.** |
| Retry | Yes |
| Source | F7 (Rate API documentation page) |

### 3.2 Ship (`createShipment`) and labels

| Item | Value |
|---|---|
| Method and path | `POST /ship/v1/shipments`: **confirmed (secondary)** by the F5 SDK source (`index.js` lines 80-83 @ `7134d2e`) and brief Appendix B; **unverified** on the portal (the Ship page names operations but not paths) |
| Operations named on the Ship page | Create Shipment, Validate Shipment (HTTP 200 plus a transaction id, with errors/warnings/notes/alerts), Retrieve Async Ship (`jobId` and `accountNumber`), Cancel Shipment, Create Tag, Cancel Tag |
| Request fields | Prose names: `accountNumber`, pickup type, service type, packaging type, shipper and recipient information, payment type and payer, package weights, `processingOptions`, `pickupDetail`, `shipper.tins[]` (for example IOSS numbers), `requestedShipment.customsClearanceDetail.commodities[].regulatoryDetails[]` (`regulationCode`, `productId`, `productIdType`, `details`). Label options: `labelResponseOptions` (`URL_ONLY` appears in a third-party SDK example (F5 README); `LABEL` unverified), `labelSpecification` (image type, printer format, stock): values such as `PDF`, `PNG`, `ZPLII` and stock types are **unverified**. **Request inline label bytes (`LABEL`) only; never `URL_ONLY`** (see section 3.10) |
| Response | Prose: tracking number and label information. Conventional `output.transactionShipments[].masterTrackingNumber`, `pieceResponses[]`, `packageDocuments[]` (`encodedLabel` or `url`): **unverified**. Label content is taken only from the response body (`encodedLabel`); a `url` is never dereferenced by the adapter and never surfaced to clients |
| Idempotency | No client-reference de-duplication confirmed. Declare `idempotent create = false` (ambiguous create leads to `EXCEPTION`) |
| Retry | Never (ADR-0010) |
| Source | F8 (Ship API documentation page, first 100,000 of 177,634 characters read), F5 |

### 3.3 Cancel shipment (`cancelShipment`)

`PUT /ship/v1/shipments/cancel`: path **and** method `PUT` are **confirmed (secondary)** by the F5 SDK source (`index.js` lines 35-38 @ `7134d2e`). A Microsoft connector page seen as a search result (F11d) describes the operation as cancelling Express and Ground shipments not yet tendered to FedEx, all packages included. FedEx's Ship page says Cancel Shipment applies to created shipments/packages that have been tendered; the sources conflict on the tendered condition (**open question**). Response: an indicator and a message (prose only). Retry: yes (idempotent per ADR-0010).

### 3.4 Track (`track`)

| Item | Value |
|---|---|
| Method and path | `POST /track/v1/trackingnumbers`: **confirmed (secondary)** (F5 SDK source `index.js` lines 258-261 @ `7134d2e`; search result F11e describing the tracking-number lookup; brief Appendix B). Other Basic Integrated Visibility operations: by reference, by TCN (1 per request), multiple-piece shipment, documents (SPOD, bill of lading, freight billing: PDF or PNG), send notifications, batch tracking |
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

Catalog API `address-validation/v1` (confirmed by a third-party SDK's documentation links); path and method `POST /address/v1/addresses/resolve` are **confirmed (secondary)** by the F5 SDK source (`index.js` lines 303-306 @ `7134d2e`); request and response field names remain **unverified**. Address Validation is **virtualized** in the sandbox, and it is not part of the virtualized rate logic (the rate sandbox validates only the country). Source F6, F5.

### 3.7 Locations / service points (optional `findServicePoints`)

"FedEx Location Search" is listed as a virtualized sandbox API (F6). Path, version and fields: **unverified** (not read).

### 3.8 Trade documents upload / ETD (optional `uploadCustomsDocuments`)

| Item | Value |
|---|---|
| Method and path | `POST /documents/v1/etds/upload`, `multipart/form-data` with the document as an attachment: **confirmed (secondary)** from FedEx's ETD quick guide as quoted in search results (F11c; PDF returned access denied to the fetcher) |
| Hosts | **Different from the main API:** sandbox `https://documentapitest.prod.fedex.com/sandbox`, production `https://documentapi.prod.fedex.com` (the same quick guide, F11c). Add them to the per-environment egress rules (ADR-0016; SPK-02 §4 item 6) **only when the ETD operation is implemented and the hosts are verified on an official FedEx page**, as exact origin plus path prefix (the sandbox host name contains `prod`, so no wildcard, suffix or "looks like production" rule may be used) |
| Workflow | `workflowName` = `ETDPreShipment` (before ship) or `ETDPostShipment` (after); up to five documents per request. The returned `documentId` goes into the ship request special services (`etdDetail`) |
| Quality of evidence | Secondary, unverified against the portal page (`catalog/upload-documents/v1/docs.html`, not read) |

### 3.9 Landed cost / duties and taxes

FedEx has an estimated duties and taxes feature (guide `fedex-api-estimated-duties-taxes`, access denied to the fetcher) tied to the Rate API's customs data. No separate landed-cost endpoint was confirmed: `estimateLandedCost` is **unverified** and should be declared unsupported for FedEx (REQ-CARR-003 `CAPABILITY_NOT_SUPPORTED`) unless the Rate API's duties and taxes output is chosen as the source (open question).

### 3.10 Personal data and secrets

Input for the per-carrier redactor deny-list (ADR-0010 amendment 8, TASK-188), the SEC-TC-52/AC-45 sentinel tests and the TASK-113/TASK-214 URL handling. The JSON paths below are the **conventional** FedEx shapes and are **unverified** until the person-diff of SPK-02 §4 item 4; TASK-139 owns the final `sensitive-fields` module.

| Operation | Request-side personal data, tax IDs and secrets (field names) |
|---|---|
| OAuth token (form body) | `client_id`, **`client_secret`**, `child_key`, **`child_secret`**; response `access_token`. Never logged, never captured (section 1) |
| Rate, Ship | `accountNumber.value` (account ID); `requestedShipment.shipper`, `recipients[]` (and `soldTo`, `importerOfRecord` in customs data): `contact.personName`, `contact.phoneNumber`, `contact.emailAddress`, `contact.companyName`, `address.streetLines[]`, `tins[]` (`number`: PAN, GSTIN, IEC or IOSS values: `SPER`, never logged); `customsClearanceDetail` (commercial invoice data) |
| Pickup create | Pickup contact name, phone and address (`originDetail.pickupLocation.contact`, `address`: names unverified); `associatedAccountNumber` |
| Track | Tracking numbers in the body (`trackingInfo[]`); reference tracking: account number, destination postal code and country |
| ETD upload | Document content (customs invoice: names, addresses, tax IDs) |
| Any call | `Authorization: Bearer` token; `x-customer-transaction-id` (correlation ID only, never personal data) |

**Identifiers and personal data in URL paths or query strings:** none in the paths named in this README (all FedEx operations above are `POST`/`PUT` with JSON bodies; `Retrieve Async Ship` takes `jobId` and `accountNumber`, location unverified). TASK-113 still records a route template, never the full URL.

**Data minimisation flags (TASK-139, binding):** request inline labels (`labelResponseOptions=LABEL`), never `URL_ONLY`; never follow or surface a returned label `url`; do not request Track documents (SPOD signature proof of delivery); set `includeDetailedScans` only as tracking needs it. Enabling any of these needs a story and an ADR-0019 document path.

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

Web pages cannot be pinned to a commit; their retrieval date is the pin. GitHub sources are pinned to the commit read.

| ID | Source | Pin / retrieved | Used for |
|---|---|---|---|
| F1 | https://developer.fedex.com/api/en-us/catalog/authorization/v1/docs.html | web page, not pinnable · retrieved 2026-11-12 | OAuth endpoint, grants, fields, `expires_in` example 3600 |
| F2 | Brief Appendix B (`shipping-platform-brief.md` in this repository) | commit `762b006144ad170c9e2c728669fc679be791dd48` (last change to the file) · 2026-11-12 | Hosts; paths seen in integrations |
| F3 | https://developer.fedex.com/api/en-us/guides/best-practices.html | web page, not pinnable · retrieved 2026-11-12 | Token reuse on 401, status codes, test and production URLs |
| F4 | https://developer.fedex.com/api/en-us/guides/ratelimits.html | web page, not pinnable · retrieved 2026-11-12 | 1,400 per 10 s, quotas, 429 texts, token-service throttle, penalty |
| F5 | https://github.com/stores-com/fedex/tree/7134d2e3380c72eafffe9641f963d0a8681cced3 (third-party SDK, `README.md` and `index.js`) | `7134d2e` (committed 2026-10-27; default-branch head on 2026-11-12) · 2026-11-12 | README: hosts (production default, sandbox by option), `URL_ONLY` example, 200 with `errors[]`, `expires_in` 3600 in an example. `index.js`: `x-customer-transaction-id` (line 32), `PUT /ship/v1/shipments/cancel` (lines 35-38), `POST /ship/v1/shipments` (lines 80-83), `POST /oauth/token` form body (line 118), `PUT /ship/v1/endofday/` (line 168), `POST /rate/v1/rates/quotes` (lines 213-216), `POST /track/v1/trackingnumbers` (lines 258-261), `POST /address/v1/addresses/resolve` (lines 303-306) |
| F6 | https://developer.fedex.com/api/en-us/guides/sandboxvirtualization.html | web page, not pinnable · retrieved 2026-11-12 | Virtualized sandbox rules and API list |
| F7 | https://developer.fedex.com/api/en-us/catalog/rate/v1/docs.html | web page, not pinnable · retrieved 2026-11-12 | Rate behaviours (prose); no paths |
| F8 | https://developer.fedex.com/api/en-us/catalog/ship/v1/docs.html | web page, not pinnable · retrieved 2026-11-12 | Ship operations (prose); no paths |
| F9 | https://developer.fedex.com/api/en-us/catalog/track/v1/docs.html | web page, not pinnable · retrieved 2026-11-12 | Track operations, 30-number limit (prose); no paths |
| F10 | https://developer.fedex.com/api/en-us/catalog/pickup/v1/docs.html | web page, not pinnable · retrieved 2026-11-12 | Pickup rules (prose); no paths |
| F11a | Search-result card (page not read): https://developer.fedex.com/api/en-us/catalog/rate.html | search result, not pinnable · retrieved 2026-11-12 | Rates and Transit Times "1.0.0", last updated 2020-07-27 (API version row) |
| F11b | Search-result snippet (PDF not readable, access denied): https://www.fedex.com/content/dam/fedex/apac-asia-pacific/downloads/fedex-api-estimated-duties-taxes-en-apac.pdf | search result, not pinnable · retrieved 2026-11-12 | "Rate and Transit Times (rate/v1/rates/quotes)" (section 3.1) |
| F11c | Search-result snippet (PDF not readable, access denied): https://www.fedex.com/content/dam/fedex/apac-asia-pacific/downloads/fedex-api-etd-quickguide-en-apac.pdf | search result, not pinnable · retrieved 2026-11-12 | ETD upload path `POST /documents/v1/etds/upload`, `multipart/form-data`, sandbox and production ETD hosts, workflow names (section 3.8) |
| F11d | Search-result snippet (page not readable when fetched directly during the capture): https://learn.microsoft.com/en-us/connectors/fedex | search result, not pinnable · retrieved 2026-11-12 | Cancel Shipment semantics: untendered Express and Ground shipments, all packages (section 3.3). The path itself now rests on F5 |
| F11e | Search-result snippet for the query `developer.fedex.com track API "track/v1/trackingnumbers"` (regional developer.fedex.com `catalog/track/docs.html` pages) | search result, not pinnable · retrieved 2026-11-12 | Tracking-number lookup description (section 3.4); the path itself now rests on F5 |

## 6. ADR-0010 re-verify items: result

| Item | Result |
|---|---|
| OAuth `POST /oauth/token`, grants, `expires_in` (example 3600; read per response) | **Confirmed** (F1) |
| Hosts `apis-sandbox.fedex.com` / `apis.fedex.com` | **Confirmed** (F3, F5) |
| `/rate/v1/rates/quotes` | **Confirmed (secondary)** (`POST`; F5 `index.js` L213-216 @ `7134d2e`, F11b) |
| `/ship/v1/shipments` | **Confirmed (secondary)** (`POST`; F5 `index.js` L80-83 @ `7134d2e`, brief) |
| `PUT /ship/v1/shipments/cancel` | Path and method **confirmed (secondary)** (F5 `index.js` L35-38 @ `7134d2e`) |
| `/track/v1/trackingnumbers` | **Confirmed (secondary)** (`POST`; F5 `index.js` L258-261 @ `7134d2e`) |
| `/pickup/v1/pickups`, `/pickup/v1/pickups/cancel` | **Unverified** (not in F5) |
| `/address/v1/addresses/resolve` | **Confirmed (secondary)** (`POST`; F5 `index.js` L303-306 @ `7134d2e`) |
| ETD upload | Path and distinct hosts **confirmed (secondary)** (F11c, search snippet only) |
| Rate API notes (estimates, truncated decimals) | **Confirmed** (F7) |

## 7. Open questions

1. A person with portal access should download each API's OpenAPI definition and the "JSON API Collection" and diff the paths, methods and field names above (blocks TASK-139 closing the contract, not starting).
2. Request and response bodies of cancel shipment and address resolve (paths and methods confirmed (secondary) by F5); paths, methods and bodies of create pickup, cancel pickup and location search.
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
| `oauth-token` | `token-success` (TTL derived from the response `expires_in`; the fixture value is not assumed by the code), `token-success-csp` | `token-401-bad-credentials-negative-cache`, `token-403-ip-penalty-opens-breaker` (no further token request during the cool-down; all FedEx accounts fail fast), `token-429`, `token-500` | `token-expiry-minus-60s-refresh`, `token-expires-in-missing`, `token-expires-in-non-numeric`, `token-expires-in-below-skew` (`≤ 60`: use once, do not cache), `token-401-on-api-call-then-refresh-once`, `token-concurrent-refresh-single-flight`, `token-request-body-not-logged` (sentinels in `client_secret` and `child_secret`) |
| `rate` | `rate-us-in-express-ground`, `rate-list-and-account-rates`, `rate-returntransittimes` | `rate-400-invalid-postal`, `rate-401-expired-token`, `rate-403`, `rate-422-service-unavailable`, `rate-429-window`, `rate-429-daily-quota`, `rate-503` | `rate-200-with-errors-array`, `rate-decimal-dimensions-truncated`, `rate-unmapped-service-type`, `rate-unmapped-surcharge`, `rate-no-freight-services`, `rate-multi-package`, `rate-timeout` |
| `ship` | `ship-pdf-label-inline` (`labelResponseOptions=LABEL`, base64 `encodedLabel`), `ship-label-encoded`, `ship-zplii-label`, `ship-international-with-customs`, `ship-with-etd-document-id` | `ship-400-invalid-address`, `ship-401`, `ship-403`, `ship-422-service-not-allowed`, `ship-429`, `ship-500-ambiguous`, `ship-timeout-ambiguous`, `ship-label-url-only-not-followed` (negative: a response with only a `url`, pointing to an off-list host or `https://169.254.169.254/`, causes zero outbound requests, no carrier URL in the canonical result and a label-missing error) | `ship-200-with-warnings`, `ship-multi-piece`, `ship-validate-shipment-notes-alerts`, `ship-async-job-pending` |
| `ship-cancel` | `cancel-success` | `cancel-400-already-cancelled`, `cancel-404-unknown`, `cancel-422-already-tendered` | `cancel-after-pickup-created` |
| `track` | `track-delivered`, `track-in-transit`, `track-out-for-delivery`, `track-label-created`, `track-exception`, `track-returned` | `track-404-not-found`, `track-400-invalid-number`, `track-401`, `track-429`, `track-503`, `track-authenticated-delivery-error` | `track-batch-30-numbers`, `track-partial-not-found-in-batch`, `track-delay-detail-weather`, `track-estimated-window`, `track-multi-piece-mps`, `track-signatory-redaction` |
| `pickup-create` | `pickup-create-express`, `pickup-create-ground` | `pickup-create-400-past-ready-time`, `pickup-create-422-inside-access-time`, `pickup-create-429`, `pickup-create-500-ambiguous` | `pickup-create-remote-area`, `pickup-create-duplicate-same-day` |
| `pickup-cancel` | `pickup-cancel-express-same-day`, `pickup-cancel-ground` | `pickup-cancel-400-after-dispatch`, `pickup-cancel-404-unknown` | `pickup-cancel-ground-over-24h` |
| `address-resolve` (optional) | `address-resolved`, `address-resolved-residential` | `address-400-bad-country` | `address-ambiguous`, `address-unresolved` |
| `locations` (optional) | `locations-by-postal` | `locations-400-invalid` | `locations-empty` |
| `etd-upload` (optional) | `etd-pre-shipment-success`, `etd-post-shipment-success` | `etd-400-too-many-documents`, `etd-400-unsupported-type` | `etd-five-documents` |
