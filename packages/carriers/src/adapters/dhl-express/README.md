# DHL Express adapter (MyDHL API, REST)

Documentation capture for TASK-009 (SPK-02). Nothing here was produced by calling a DHL endpoint: no credentials exist (D-003) and the platform runs on the Mock carrier. **developer.dhl.com is protected by a WAF and returned "Request Rejected" to every automated fetch on 2026-11-12, so the official OpenAPI specification and the portal reference could not be read.** Everything below that is marked **confirmed (secondary)** comes from the source code of the public third-party SDK `sonnenglas/mydhl-php-sdk` (MIT, aligned with spec 3.3.1), which exercises the live endpoints; it is evidence of paths and parameters, not of DHL's own documentation. Items DHL's own pages must settle are marked **unverified**. Fixtures written from this are **synthesised** until a live sandbox run (`CARRIER_LIVE_SANDBOX=1`, COND-SANDBOX-DEMO) confirms them.

| Field | Value |
|---|---|
| Docs URL | https://developer.dhl.com/api-reference/dhl-express-mydhl-api (portal, blocked to automation; read by a person at implementation time) |
| API version | MyDHL API REST, spec line **3.3.x**. The SDK pins `x-version: 3.3.1` ("dated June 2026" per its README); ADR-0010 records reference-data guides 3.3.0 and 3.3.2. A search snippet of the portal shows "2.13.3" for an older listing. The current value of the `x-version` header is **unverified against DHL** |
| Date checked | 2026-11-12 |
| Spec diff | Diffed against official spec by a person: no (ADR-0010 am. 11 item 4; listed under COND-SANDBOX-DEMO until a person with portal access diffs it) |
| Verdict | **FALLBACK for operation semantics and field names** (paths confirmed from a secondary source; official spec unreadable). Fixtures are built from the secondary evidence and must be checked against the official YAML by a person with portal access (see section 7) |
| Sandbox quirks | See [Sandbox quirks](#4-sandbox-quirks) |

## 1. Environments and authentication

| Item | Value | Source |
|---|---|---|
| Sandbox base URL | `https://express.api.dhl.com/mydhlapi/test` | D1, D2 |
| Production base URL | `https://express.api.dhl.com/mydhlapi` | D1, D2 |
| Authentication | HTTP Basic with the MyDHL API key as username and secret as password (`Authorization: Basic <base64 of key:secret>`), plus the DHL Express **account number** inside request bodies/queries. Placeholders: `<DHL_API_KEY>`, `<DHL_API_SECRET>`, `<DHL_ACCOUNT_NUMBER>`. Brief Appendix B states HTTP Basic; the SDK sends the credentials with an HTTP client `auth` pair, which is Basic. **No token endpoint, no token lifetime** (not OAuth), so `TokenCache` is unused for this carrier | D2, brief App. B |
| Required headers (SDK sends them on every call) | `Content-Type: application/json`, `Message-Reference` (generated unique string), `Message-Reference-Date` (RFC 7231 HTTP date in GMT, e.g. `Thu, 12 Nov 2026 10:00:00 GMT`), `x-version` (`3.3.1`). ADR-0010 asked to re-verify `Message-Reference`, `Message-Reference-Date`, `x-version`: all three are **confirmed (secondary)**. Length and format limits of `Message-Reference` (DHL documents 28 to 36 characters, unverified here) | D2 |
| Onboarding | Developer registration at `https://developer.dhl.com/user/register`; DHL Express onboarding form at `https://developer.dhl.com/form/dhl-express-onboarding` for developers who are not DHL Express customers | D3 |
| GET/DELETE parameters | Query string; POST/PATCH parameters in the JSON body (SDK behaviour) | D2 |

## 2. Error model and rate limits

- Failure bodies carry a problem document; the SDK documents `additionalDetails` (list of problems) in the raw body. The full field set (`instance`, `detail`, `title`, `message`, `status`, `additionalDetails[]`) is how the portal describes the model in general, but this README could not confirm it: **unverified**. Map by HTTP status and any machine code found in the body, never by message text.
- Client-side failure classes the adapter must distinguish (ADR-0010): no response (DNS, connect/read timeout, TLS) vs HTTP status. After an ambiguous `createShipment` the saga marks the shipment `EXCEPTION`.
- **Sandbox quota: 500 calls per day per credential set** (SDK README; a portal search snippet in Japanese says the same). Production quota: not stated. This is why `CARRIER_DAILY_QUOTA=500` is seeded for the DHL sandbox account (ADR-0010 amendment 3).

## 3. Operations

All paths are relative to the base URL in section 1. "Confirmed (secondary)" = present in the SDK source for spec 3.3.1.

### 3.1 Rate (`getRates`)

| Item | Value |
|---|---|
| Single piece | `GET /rates`, confirmed (secondary). Query: `accountNumber`, `originCountryCode`, `originPostalCode`, `originCityName`, `destinationCountryCode`, `destinationPostalCode`, `destinationCityName`, `weight`, `length`, `width`, `height`, `plannedShippingDate` (`YYYY-MM-DD`), `isCustomsDeclarable` (`true`/`false`), `unitOfMeasurement` (`metric`/`imperial`), `nextBusinessDay` |
| Multi piece | `POST /rates` (body carries the package list), confirmed (secondary) |
| Products only | `GET /products` (available products for a lane, same lane/weight parameters), confirmed (secondary) |
| Response | `products[]`: `productCode`, `productName`, `localProductCode`, `localProductCountryCode`, `totalPrice[]` (`currencyType` such as billing and base currency, `priceCurrency`, `price`), `weight` (`volumetric`, `provided`), `deliveryCapabilities.estimatedDeliveryDateAndTime`, `pricingDate`, `isCustomerAgreement`; `warnings[]`. Itemised surcharges: **unverified** (the SDK reads totals only) |
| Mapping notes | `productCode` maps to `DHL_<code>` services (DR-B30); pick the billing-currency total; negotiated pricing is implied by `isCustomerAgreement` |
| Retry | Yes (idempotent) |

### 3.2 Ship (`createShipment`) and labels

| Item | Value |
|---|---|
| Path | `POST /shipments`, confirmed (secondary) |
| Request fields seen | `plannedShippingDateAndTime`, `productCode`, `accounts[]` (`typeCode`, `number`), `customerDetails` (`shipperDetails`, `receiverDetails`, each with `postalAddress`, `contactInformation`, optional `typeCode`), `content` (`packages[]` with `weight` and `dimensions` `length`/`width`/`height`, `isCustomsDeclarable`, `description` **1 to 70 characters, required on every shipment including domestic**, `incoterm` **required on every shipment**, `unitOfMeasurement`, `declaredValue`, `declaredValueCurrency`, `exportDeclaration`), `pickup` (`isRequested`, per the SDK doc comment), `getRateEstimates`, `outputImageProperties` (`printerDPI` 200 or 300, `encodingFormat`, `splitTransportAndWaybillDocLabels`, `allDocumentsInOneImage`, `imageOptions[]`) |
| Label formats | `encodingFormat` ∈ `pdf`, `zpl`, `lp2`, `epl` (SDK allow-list), confirmed (secondary). Label is returned **inline, base64, only by this call**; `GET /shipments/{n}/get-image` does not return the transport label, so persist it immediately (idempotency/duplicate-label guardrail) |
| Response fields seen | `shipmentTrackingNumber`, `packages[]` (per-piece tracking numbers), `documents[]` (`typeCode`, `imageFormat`, `content` base64), `trackingUrl`, `cancelPickupUrl`, `dispatchConfirmationNumber`, `shipmentCharges`, `warnings[]`. Label bytes come only from `documents[].content`. `trackingUrl` and `cancelPickupUrl` are **never followed** by the adapter and **never surfaced** to clients: customer tracking links come from a configured per-carrier template, and pickup cancel goes through the configured base URL plus section 3.6 |
| Customs | Commercial invoice data inside `content.exportDeclaration` (and `content.isCustomsDeclarable`); paperless trade uses special service `WY` (see 3.9) |
| Idempotency | No client-reference de-duplication confirmed. Declare `idempotent create = false` |
| Retry | Never (ADR-0010) |

### 3.3 Cancel shipment (`cancelShipment`) - gap

**No cancel/delete-shipment operation appears in the SDK, which wraps every MyDHL operation it knows (rates, products, shipments incl. add-piece/upload-image/upload-invoice-data, tracking, pickups incl. update and cancel, images, proof of delivery, address validate, service points, landed cost, identifiers, reference data, early shipment screening).** Whether MyDHL exposes shipment cancellation is therefore **unverified**; the SDK suggests it does not (cancelling a pickup is the available action). Recommended: declare `cancelShipment` as `CAPABILITY_NOT_SUPPORTED` for DHL until the official spec shows otherwise, and let the saga void the Platform shipment while the carrier shipment lapses, and cancel the pickup via 3.6. **This is the main FALLBACK item (section 8).** Because the label is returned only by `createShipment` (3.2) and there is neither a cancel nor a label recovery, an ambiguous create (timeout or 5xx) can leave a carrier shipment that exists without a stored label and cannot be cancelled; TASK-135 needs a reconciliation step for ambiguous creates (for example a tracking lookup by shipper reference, which is **unverified** for MyDHL) before the saga settles on `EXCEPTION`.

### 3.4 Track (`track`)

| Item | Value |
|---|---|
| Single | `GET /shipments/{shipmentTrackingNumber}/tracking`, confirmed (secondary). Query: `trackingView` ∈ `all-checkpoints`, `all-checkpoints-with-remarks`, `last-checkpoint`, `shipment-details-only`, `advance-shipment`, `bbx-children`; `levelOfDetail` ∈ `shipment`, `piece`, `all`; `requestGMTOffsetPerEvent=true` |
| Batch | `GET /tracking?shipmentTrackingNumber=<comma list>` with the same `trackingView` and `levelOfDetail`; **maximum 200 waybills per call** (SDK limit). The batch response has **no GMT offset per event**: use the single call when event times matter |
| Response | `shipments[]` of tracked shipments with `events[]` and `pieces[]`; field names are not enumerated in the SDK source read and are **unverified** (event `typeCode`, `description`, `date`, `time`, `serviceArea` with city and country code expected) |
| Proof of delivery | `GET /shipments/{n}/proof-of-delivery` with `content` ∈ `epod-detail`, `epod-summary`, `epod-table`, `epod-detail-esig`, confirmed (secondary) |
| Pickup status | Pickups have no read endpoint; evidence of collection comes from tracking scans |
| Retry | Yes. Tracking event code reference data: `GET /reference-data` dataset `trackingEventCode` (3.8) |

### 3.5 Images and documents

`GET /shipments/{n}/get-image` re-downloads archived documents of type `waybill`, `commercial-invoice`, `customs-entry`, `transport-accompanying-document`, `generic-entry-summary`, `dhl-issued-proforma-invoice` (query: `shipperAccountNumber`, `typeCode` (comma list), `pickupYearAndMonth` as `YYYY-MM`, `encodingFormat`, `allInOnePDF`), confirmed (secondary). Not for the transport label.

### 3.6 Pickup (`schedulePickup`, `cancelPickup`)

| Item | Value |
|---|---|
| Create | `POST /pickups`, confirmed (secondary). Body: `plannedPickupDateAndTime` (must be in the future and **within 10 days**), `closeTime`, `location`, `locationType`, `remark`, `accounts[]`, `customerDetails` (`shipperDetails` with `postalAddress` and `contactInformation`), `shipmentDetails[]` |
| Create response | `dispatchConfirmationNumbers[]`, `nextPickupDate`, `readyByTime`, `warnings[]` |
| Update | `PATCH /pickups/{dispatchConfirmationNumber}` keeps the confirmation number, confirmed (secondary) |
| Cancel | `DELETE /pickups/{dispatchConfirmationNumber}` with query `requestorName` and `reason` (both required), confirmed (secondary) |
| Read | None (`/pickups` accepts POST, PATCH and DELETE only) |
| Retry | Create never, cancel yes (ADR-0010) |

### 3.7 Address validation (optional `validateAddress`)

`GET /address-validate` (validates pickup/delivery capability; query includes `type` and `countryCode`, other parameters not read), confirmed (secondary). Response contains address candidates and service area; field names **unverified**.

### 3.8 Service points (optional `findServicePoints`) and reference data

`GET /servicepoints` (search by address or by coordinates), confirmed (secondary); `GET /reference-data` with `datasetName` and up to three filters (datasets include `country`, `incoterm`, `productCode`, `serviceCode`, `packageTypeCode`, `documentTypeCode`, `trackingEventCode`, `unitOfMeasurement`), confirmed (secondary). Reference-data guides 3.3.0/3.3.2 (ADR-0010) are portal documents and were not readable.

### 3.9 Paperless trade / customs upload (optional `uploadCustomsDocuments`)

| Item | Value |
|---|---|
| After shipment | `PATCH /shipments/{n}/upload-image`, confirmed (secondary). The shipment must carry special service **`WY`** and DHL requires **at least ten minutes** between creating the shipment and the first upload (earlier calls are rejected). A successful upload has no response body |
| Invoice data after shipment | `PATCH /shipments/{n}/upload-invoice-data` (shipments created with product code `PM` only), confirmed (secondary) |
| Invoice data before shipment | `POST /invoices/upload-invoice-data` (a different declaration schema than shipments), confirmed (secondary) |
| Other | `PATCH /shipments/{n}/add-piece` (access granted per customer by DHL); `GET /identifiers` (allocate `SID`, `PID`, `ASID3/6/12/24`, `HUID`); `POST /early-shipment-screening` |

### 3.10 Landed cost (optional `estimateLandedCost`)

`POST /landed-cost`, confirmed (secondary): duties, taxes and fees for a lane with item lines; ADR-0010's `/landed-cost` path matches. Field names unverified.

### 3.11 Personal data and secrets

Input for the per-carrier redactor deny-list (ADR-0010 amendment 8, TASK-188), the SEC-TC-52/AC-45 sentinel tests and the TASK-113/TASK-214 URL handling. Field names are **confirmed (secondary)** from the D2 SDK value objects @ `50edb9b` (`src/ValueObjects/Contact.php`, `Address.php`, `RegistrationNumber.php`, `ShipmentRequest.php`) and stay **unverified** against DHL's spec until the person-diff (section 7 item 1). TASK-135 owns the final `sensitive-fields` module.

| Operation | Request-side personal data, tax IDs and secrets (field names) |
|---|---|
| Every call | `Authorization: Basic` header (API key and **secret**) |
| Rate (`POST`), Ship | `accounts[].number` (account ID); `customerDetails.shipperDetails` / `receiverDetails` (and other parties): `contactInformation.fullName`, `contactInformation.companyName`, `contactInformation.phone`, `contactInformation.email`, `postalAddress.addressLine1` to `addressLine3`, `postalAddress.postalCode`, `postalAddress.cityName`; `registrationNumbers[]` (`typeCode`, `number`, `issuerCountryCode`: PAN, GSTIN, IEC or VAT values, `SPER`, never logged); `content.exportDeclaration` (invoice parties and line items) |
| Pickup create and update | `customerDetails.shipperDetails.contactInformation.*` and `postalAddress.*` as above; `accounts[].number`; `remark` (free text: must not carry personal data) |
| Invoice data and upload-image | Invoice parties (`registrationNumbers[]`, contact and address fields) and document content |

**Identifiers and personal data placed in URL paths or query strings** (these reach HttpClient logs, error text and OTel `url.full` and bypass body redaction; TASK-113 records a route template instead):

- `GET /rates` and `GET /products`: `accountNumber`, `originPostalCode`, `originCityName`, `destinationPostalCode`, `destinationCityName` in the query.
- `GET /shipments/{n}/tracking` and `GET /tracking?shipmentTrackingNumber=…`: waybill numbers in the path or query.
- `GET /shipments/{n}/get-image`: `shipperAccountNumber` in the query.
- `DELETE /pickups/{dispatchConfirmationNumber}`: `requestorName` (**required**, naturally a person's name) and `reason` in the query. The adapter sends a fixed, non-personal `requestorName` derived from `BRAND_*` configuration (or an operations role name), never a user's or shipper's name, and `reason` from a fixed enum.
- `GET /address-validate`: address parts in the query.

**Data minimisation flags (TASK-135, binding):** use `trackingView=all-checkpoints` (not `all-checkpoints-with-remarks`, not `shipment-details-only`); do not call `GET /shipments/{n}/proof-of-delivery` (in particular not `epod-detail-esig`, which returns a signature); never follow `trackingUrl` or `cancelPickupUrl` (section 3.2). Enabling any of these needs a story and an ADR-0019 document path.

## 4. Sandbox quirks

- 500 calls per day per credential set (section 2). Use one or two calls per live run.
- Pickups cannot be read back; labels created in the test environment may not be trackable (brief App. B, unverified for DHL).
- Batch tracking events lack GMT offsets (section 3.4).
- `description` (1 to 70) and `incoterm` are required even for domestic shipments (section 3.2).
- Sandbox and production credentials are separate: model as separate carrier accounts.

## 5. Sources

Web pages and search snippets cannot be pinned to a commit; their retrieval date is the pin. The GitHub source is pinned to the commit read.

| ID | Source | Pin / retrieved | Used for |
|---|---|---|---|
| D1 | https://developer.dhl.com/api-reference/dhl-express-mydhl-api | web page, not pinnable · retrieved 2026-11-12 | **Not readable (WAF "Request Rejected")**; listed so the gap is explicit |
| D2 | https://github.com/sonnenglas/mydhl-php-sdk/tree/50edb9bb5108b39c440f27e680d80524477e9a59 (README, `src/Client.php`, `src/Services/*.php`, `src/ValueObjects/*.php`, `src/ResponseParsers/*.php`; third party, MIT, spec 3.3.1) | `50edb9b` (committed 2026-08-06; default-branch head on 2026-11-12) · 2026-11-12 | Base URLs (`src/Client.php` lines 24-25: `…/mydhlapi/` and `…/mydhlapi/test/`), headers, paths, parameters, limits, quirks, personal-data field names (section 3.11) |
| D3 | https://www.dhl.de/int-static/downloads/ext/dhl/express/Developer_Portal_MyDHL_API_EN.pdf (official DHL PDF, 3 slides, created 2025-07-03; text streams unreadable, only link annotations read) | PDF, not pinnable · retrieved 2026-11-12 | Onboarding links only |
| D4a | https://www.dhl.com/discover/en-gb/ship-with-dhl/shipping-solutions/shipping-tools/mydhl-api (official DHL marketing page, via search result) | search result, not pinnable · retrieved 2026-11-12 | Existence of the REST API, test and production hosts |
| D4b | https://www.dhl.de/en/geschaeftskunden/express/business-loesungen/mydhlapi.html (official DHL marketing page, via search result) | search result, not pinnable · retrieved 2026-11-12 | YAML in the portal Downloads section |
| D5 | Search snippet of https://developer.dhl.com/express (Japanese locale) | search result, not pinnable · retrieved 2026-11-12 | 500 calls per day sandbox quota (corroborates the SDK) |

## 6. ADR-0010 re-verify items: result

| Item | Result |
|---|---|
| `/rates`, `/products`, `/shipments`, `/pickups`, `/tracking`, `/address-validate`, `/landed-cost`, `/shipments/{n}/upload-image` | **Confirmed (secondary)**; also `GET /shipments/{n}/tracking` for single tracking |
| Headers `Message-Reference`, `Message-Reference-Date`, `x-version` | **Confirmed (secondary)** |
| Current version string | `x-version: 3.3.1` per the SDK; **unverified against DHL** |
| Sandbox quota ~500/day | **Corroborated** by two secondary sources |
| Cancel shipment | **Not found** (section 3.3) |

## 7. Open questions

1. Official OpenAPI YAML (portal Downloads section): a person with portal access must diff the paths, headers and schemas in this README against it before TASK-135 is closed.
2. Does MyDHL have a cancel/delete shipment operation? If not, `cancelShipment` is unsupported for DHL.
3. Error model fields and a catalogue of error codes for `400`, `401`, `404`, `422`, `429`, `5xx`.
4. Surcharge itemisation in rate responses and how to map it to canonical surcharges.
5. Tracking response schema (event type codes, date and time fields, GMT offset) and sandbox canned tracking numbers.
6. `Message-Reference` length and uniqueness rules.
7. Production rate limits; whether `429` is used or a different status.
8. Label size options (6x4 etc.) and the precise `imageOptions` structure for waybill and commercial invoice documents.
9. Whether a client reference on create gives idempotency.
10. India lane specifics (customs requirements, product codes) for US to IN shipments.

## 8. FALLBACK summary (ADR-0010 amendment request)

- `cancelShipment`: treat as unsupported until verified (section 3.3).
- All DHL request/response field names beyond those listed: fixtures are synthesised and flagged "to be diffed against the official YAML".
- Live sandbox stays opt-in (REQ-CARR-020, COND-SANDBOX-DEMO).

## 9. Fixture plan per operation

Names only. All fixtures are **synthesised** (labelled `"_fixture": "synthesised"`), contain placeholders such as `<WAYBILL_NUMBER>` and `<DISPATCH_CONFIRMATION_NUMBER>`, and no real names, addresses, phone numbers or credentials. Layout and file names are decided by TASK-135.

| Operation | Success | Typical errors | Edge cases |
|---|---|---|---|
| `rates` (GET) | `rates-us-in-three-products`, `rates-customs-declarable`, `rates-customer-agreement` | `rates-400-invalid-postal-code`, `rates-401-bad-credentials`, `rates-404-no-product`, `rates-422-weight-limit`, `rates-429`, `rates-503` | `rates-warning-partial-products`, `rates-unmapped-product-code`, `rates-volumetric-over-provided-weight`, `rates-multiple-currencies`, `rates-timeout` |
| `rates` (POST multi-piece) | `rates-multipiece-success` | `rates-multipiece-400-too-many-pieces` | `rates-multipiece-mixed-dimensions` |
| `products` | `products-us-in` | `products-400-invalid-lane` | `products-warning-partial` |
| `shipments` (create) | `shipment-pdf-label`, `shipment-zpl-label`, `shipment-international-with-invoice`, `shipment-pickup-requested` | `shipment-400-missing-description`, `shipment-400-missing-incoterm`, `shipment-401`, `shipment-422-invalid-product`, `shipment-429`, `shipment-500-ambiguous`, `shipment-timeout-ambiguous` | `shipment-multi-piece`, `shipment-warnings-array`, `shipment-label-missing-content`, `shipment-documents-order-variant`, `shipment-carrier-urls-not-followed` (`trackingUrl` and `cancelPickupUrl` pointing to an off-list host or `https://169.254.169.254/` cause zero outbound requests and no carrier URL in the canonical result) |
| `shipments/{n}/upload-image` | `upload-image-204-empty-body` | `upload-image-400-before-ten-minutes`, `upload-image-400-missing-wy-service` | `upload-image-replace-existing` |
| `shipments/{n}/upload-invoice-data` and `invoices/upload-invoice-data` | `invoice-data-success` | `invoice-data-400-wrong-product-code` | `invoice-data-different-schema` |
| `shipments/{n}/tracking` | `track-delivered`, `track-in-transit`, `track-out-for-delivery`, `track-label-created`, `track-exception`, `track-returned` | `track-404-unknown-waybill`, `track-401`, `track-429`, `track-503` | `track-signatory-redaction`, `track-event-with-gmt-offset`, `track-multi-piece` |
| `tracking` (batch) | `track-batch-three-waybills` | `track-batch-400-over-200` | `track-batch-no-gmt-offset`, `track-batch-partial-not-found` |
| `pickups` (create) | `pickup-create-success` | `pickup-create-400-past-date`, `pickup-create-400-over-10-days`, `pickup-create-422-no-service`, `pickup-create-500-ambiguous` | `pickup-create-existing-pickup-warning` |
| `pickups/{n}` (cancel) | `pickup-cancel-success` | `pickup-cancel-404-unknown`, `pickup-cancel-400-missing-reason` | `pickup-cancel-already-collected`, `pickup-cancel-requestorname-not-personal` (the query carries the configured constant, and its sentinel never appears in logs or spans) |
| `address-validate` (optional) | `address-valid` | `address-400-unsupported-country` | `address-pickup-not-possible` |
| `servicepoints` (optional) | `servicepoints-by-address` | `servicepoints-400-bad-coordinates` | `servicepoints-empty` |
| `landed-cost` (optional) | `landed-cost-us-in` | `landed-cost-400-invalid-hs-code` | `landed-cost-partial-charges` |
| Shipment cancel | none (no operation found) | | `cancel-capability-not-supported-no-io` (contract-suite case, no HTTP fixture) |
