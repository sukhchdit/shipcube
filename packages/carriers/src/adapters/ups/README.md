# UPS adapter (UPS REST APIs, OAuth 2.0)

Documentation capture for TASK-009 (SPK-02). Nothing here was produced by calling a UPS endpoint: no credentials exist (D-003) and the platform runs on the Mock carrier. Every fact below was read from public documentation and carries its source and retrieval date. Fixtures written from it are **synthesised** until a live sandbox run (`CARRIER_LIVE_SANDBOX=1`, COND-SANDBOX-DEMO) replaces or confirms them.

| Field | Value |
|---|---|
| Docs URL | https://developer.ups.com (portal, returns HTTP 403 to automated fetches) and the official OpenAPI repository https://github.com/UPS-API/api-documentation (read in full for the APIs below) |
| API version | **v2409** for Rating, Shipping (ship and void), Pickup; **v1** Tracking, Landed Cost (default), **v2** Address Validation and Paperless Document, **v3** Locator, **v1** Label Recovery (default), OAuth `v1`. `info.version` is an empty string in every spec, so the version lives only in the URL path |
| Date checked | 2026-11-12 |
| Verdict | **GO** (all required operations confirmed from the official specs) |
| Sandbox quirks | See [Sandbox quirks](#sandbox-quirks) |

## 1. Environments and authentication

| Item | Value | Source |
|---|---|---|
| Sandbox ("CIE", Customer Integration Environment) API host | `https://wwwcie.ups.com/api` | S1 (`servers` in every spec) |
| Production API host | `https://onlinetools.ups.com/api` | S1 |
| Token endpoint | `POST https://wwwcie.ups.com/security/v1/oauth/token` (sandbox), `POST https://onlinetools.ups.com/security/v1/oauth/token` (production). Note: the token path is **not** under `/api`; the spec declares the host without the `/api` suffix for this operation | S2 |
| Grant | `client_credentials`, body `application/x-www-form-urlencoded` with `grant_type=client_credentials` | S2 |
| Client authentication | HTTP Basic: username = client ID, password = client secret (placeholders in tests: `<UPS_CLIENT_ID>`, `<UPS_CLIENT_SECRET>`) | S2 |
| Optional token header | `x-merchant-id`: the 6-digit UPS account number | S2 |
| Token response fields | `access_token`, `token_type`, `issued_at`, `expires_in`, `client_id`, `scope`, `refresh_count`, `status`. **All are typed `string` in the spec, including `expires_in` (seconds) and `issued_at`**: parse `expires_in` with `Number(...)` | S2 |
| Token lifetime | The spec gives no value. Third-party notices say UPS shortens the lifetime from 4 hours (`expires_in` about 14399) to **1 hour from 2026-04-01** (Pitney Bowes support article, updated 2026-09-02). **Unverified against a UPS page** (developer.ups.com returned 403). The adapter must read `expires_in` from every response and never hard-code a lifetime (ADR-0010 `TokenCache`: expiry minus 60 s) | S2, S9 |
| API call authentication | `Authorization: Bearer <access_token>` (OAuth2 security scheme on every operation) | S1 |
| Common request headers | `transId` (string, max 32, caller-unique request id; **required** on Tracking and Landed Cost, optional elsewhere), `transactionSrc` (string, max 512, default `testing`; **required** on Tracking and Landed Cost). Send both on every call: `transId` = correlation ID truncated to 32 characters, `transactionSrc` = `shipqube` | S1 |
| Auth error model | 400 Invalid Request, 401 Unauthorized Request, 403 Blocked Merchant, 429 Quota Limit Exceeded. Body: `{ "response": { "errors": [ { "code": "<string>", "message": "<string>" } ] } }` | S2 |

The authorization-code flow (`OAuthAuthCode.yaml`) exists but is out of scope: the Platform uses client credentials per carrier account (ADR-0010, ADR-0011).

## 2. Common error model and rate limits

- Error body on 400/401/403/429 for Rating, Shipping, Pickup, Address Validation and others: `ErrorResponse = { response: { errors: [ { code, message } ] } }` (S1, `components.schemas.ErrorResponse`). Tracking returns the same shape for 400/403/404/500/503 under `Response.response` (S1). Warnings on Tracking use `{ code, message }` in `shipment[].warnings[]`.
- Map by `code`, not by `message`. `403` means "Blocked Merchant" (account blocked or not enabled for the product), not a missing token.
- HTTP `429` is documented on every operation ("Rate Limit Exceeded"; "Quota Limit Exceeded" on the token endpoint). **No numeric rate limit or daily quota appears in any specification**; the numbers are per developer app in the portal. Treat as **unverified**; the platform quota guard (ADR-0010 amendment 3) is configuration (`CARRIER_DAILY_QUOTA`, 0 = off for UPS).
- `429` is retryable under ADR-0010 for idempotent operations only.

## 3. Operations

### 3.1 Rate (`getRates`)

| Item | Value |
|---|---|
| Method and path | `POST /rating/{version}/{requestoption}` with `version = v2409` (the only non-deprecated value) and `requestoption` one of `Rate`, `Shop`, `Ratetimeintransit`, `Shoptimeintransit` (max length 10). `Rate` is the only option valid for Ground Freight Pricing |
| Deprecated (do not use) | `POST /rating/{deprecatedVersion}/{requestoption}`, `deprecated: true`, values `v1`, `v1601`, `v1607`, `1701`, `1707`, `v2108`, `v2205` (note `1701` and `1707` have no `v`) |
| Query | `additionalinfo=timeintransit` (valid value) |
| Plan | Use `Shoptimeintransit` for fan-out quotes (all services with delivery estimates) and `Rate` with a `Service.Code` for a single service |
| Request (`RateRequest`) | Required: `Request` (`RequestOption`, optional `SubVersion` 4 chars, `TransactionReference.CustomerContext` 1-512), `Shipment`. `Shipment` required: `Shipper`, `ShipTo`, `Package` (array, max 200). Also `ShipFrom`, `Service` (`Code`), `PaymentDetails`, `NumOfPieces`, `ShipmentTotalWeight`, `ShipmentRatingOptions` (negotiated rates), `DeliveryTimeInformation`, `ShipmentServiceOptions`, `InvoiceLineTotal` (international), `TaxInformationIndicator`. Optional `PickupType.Code`, `CustomerClassification.Code` |
| Response (`RateResponse.RatedShipment[]`) | `Service`, `BillingWeight`, `TransportationCharges`, `BaseServiceCharge`, `ItemizedCharges`, `ServiceOptionsCharges`, `TaxCharges`, `TotalCharges`, `TotalChargesWithTaxes`, `NegotiatedRateCharges`, `RatedPackage`, `TimeInTransit`, `GuaranteedDelivery`, `RatedShipmentAlert`, `Disclaimer`, `Zone`, `RatingMethod` |
| Errors | `ErrorResponse` above; 429 on throttling |
| Retry (ADR-0010) | Yes (idempotent) |
| Sandbox quirks | See section 4 |
| Source | S3 (`Rating.yaml`, 10 request examples) |

Open detail: the exact charge-code to canonical surcharge mapping is taken from `ItemizedCharges[].Code` values, which the spec does not enumerate (see Open questions).

### 3.2 Ship (`createShipment`) and labels

| Item | Value |
|---|---|
| Method and path | `POST /shipments/{version}/ship`, `version = v2409` (only value). Deprecated twin: `POST /shipments/{deprecatedVersion}/ship` |
| Query | `additionaladdressvalidation=city` (valid value) |
| Request (`ShipmentRequest`) | `Request` (`RequestOption`, `SubVersion`, `TransactionReference`), `Shipment`: `Shipper` (with `ShipperNumber`), `ShipTo`, `ShipFrom`, `PaymentInformation.ShipmentCharge`, `Service` (`Code`), `Package[]` (`Packaging`, `Dimensions`, `PackageWeight`, `PackageServiceOptions`), `ShipmentServiceOptions` (includes `InternationalForms` for commercial invoice data), `ShipmentRatingOptions` (negotiated rates), plus `LabelSpecification` at request level |
| Label formats (`LabelSpecification.LabelImageFormat.Code`) | **`GIF`, `ZPL`, `EPL`, `SPL`** per the spec description ("for image formats use GIF"). `PDF` is **not** documented as a label code (one request example uses lowercase `png`, treated as an example error). The Platform label format PDF must therefore be produced by converting the GIF (or wrapping it in a PDF) in the adapter, or flagged as an open question. Thermal stock: `LabelStockSize` `Height` 6 or 8, `Width` 4. `HTTPUserAgent` is also part of the container |
| Response (`ShipmentResponse`) | `Response` (`ResponseStatus`, `Alert[]` always an array from v2403, `TransactionReference`), `ShipmentResults`: `ShipmentIdentificationNumber`, `ShipmentCharges`, `NegotiatedRateCharges`, `BillingWeight`, `PackageResults[]` (`TrackingNumber`, `ShippingLabel` (base64 `GraphicImage`), `ItemizedCharges`, `NegotiatedCharges`, `BaseServiceCharge`, `ServiceOptionsCharges`, `Form`, `Accessorial`, `SimpleRate`, `RateModifier`), `Form` (international documents), `ShippingReceipt`, `LabelURL`, `HighValueReport` |
| Idempotency | No client reference de-duplication is documented. Declare `idempotent create = false` (ADR-0010): an ambiguous create ends in `EXCEPTION` |
| Retry | Never (ADR-0010) |
| Errors | `ErrorResponse`; timeouts 20 s per ADR-0010 |
| Source | S4 (`Shipping.yaml`) |

### 3.3 Cancel shipment (`cancelShipment`, void)

| Item | Value |
|---|---|
| Method and path | **`DELETE /shipments/{version}/void/cancel/{shipmentidentificationnumber}`**, `version = v2409` (`v3` is documented only for Roadie shipments). This confirms the ADR-0010 re-verify item |
| Path parameter | `shipmentidentificationnumber`: alphanumeric, 1Z rules, upper case, length 18 |
| Query | `trackingnumber`: optional; up to 20 numbers, JSON-array style (`["<tn1>","<tn2>"]`) to void individual packages |
| Headers | `transId`, `transactionSrc` (optional), `shipperNumber` (**Roadie shipments only**) |
| Response (`VoidShipmentResponse`) | `Response` (`ResponseStatus`, `Alert[]`), `SummaryResult` (status), `PackageLevelResults[]` (always an array from v2403) |
| Retry | Yes (idempotent per ADR-0010) |
| Source | S4 |

### 3.4 Label recovery

`POST /labels/{version}/recovery`, default `v1` (other documented values `v1701`, `V1903`; `v2603` is required to support Roadie labels). Request `LabelRecoveryRequest`, response `LabelRecoveryResponse` with `Response`, `ShipmentIdentificationNumber` (leading package tracking number) and `LabelResults[]`. Use this instead of re-creating a shipment when the label download failed (guardrail: zero duplicate labels). Source S4. Request and response field detail: **unverified** beyond the names above.

### 3.5 Track (`track`)

| Item | Value |
|---|---|
| Method and path | `GET /track/v1/details/{inquiryNumber}` (single package or shipment number). Also `GET /track/v1/reference/details/{referenceNumber}` and `GET /track/v1/shipment/details/{inquiryNumber}` |
| Inquiry number | 7 to 34 characters |
| Query | `locale` (default `en_US`), `returnSignature` (default `false`), `returnMilestones` (default `false`), `returnPOD` (default `false`). Shipment variant: `offset` (default 0), `count` (default 50). Reference variant: `fromPickUpDate`, `toPickUpDate`, `destCountry`, `destZip`, `shipperNum`, `refNumType` |
| Headers | `transId` and `transactionSrc` both **required** |
| Response (`TrackApiResponse`) | `trackResponse.shipment[]` (`inquiryNumber`, `package[]`, `userRelation[]`, `warnings[]`). `package[]`: `trackingNumber`, `currentStatus`, `statusCode`, `statusDescription`, `activity[]` (most recent first), `milestones[]`, `deliveryDate[]`, `deliveryTime`, `deliveryInformation` (`pod.content` and `signature.image` are base64 and marked sensitive), `packageAddress[]`, `service`, `weight`, `packageCount`. `activity[]`: `status` (`type`, `code`, `description`, `simplifiedTextDescription`, `statusCode`), `date` (`YYYYMMDD`), `time` (`HHMMSS`), `gmtDate`, `gmtOffset`, `gmtTime`, `location.address` (`city`, `stateProvince`, `postalCode`, `country`, `countryCode`), `logicalScan` |
| Batch | No multi-number endpoint documented: one inquiry per call. `maxTrackingNumbersPerCall` capability = 1 |
| Errors | 400, 403, 404, 500, 503 with `Response.response.errors[]`; unknown number is a 404 or a warning (**unverified which**) |
| Data retention | The spec notes a 120-day retention period |
| Rate limit | Not documented |
| Retry | Yes |
| Source | S5 (`Tracking.yaml`) |

Privacy note for the adapter: redact signatory names and free text before retention (ADR-0010 amendment 8). Only city/country-level location may reach public tracking.

### 3.6 Pickup (`schedulePickup`, `cancelPickup`)

| Item | Value |
|---|---|
| Create | **`POST /pickupcreation/{version}/pickup`**, `version = v2409`. Body is one of the standard `PickupCreationRequest` or the Smart Pickup request; use the standard one |
| Create request | Required: `RatePickupIndicator` (`Y`/`N`), `PickupDateInfo` (`PickupDate` as `yyyyMMdd` although the schema says length 4, `ReadyTime` and `CloseTime` as `HHmm`), `PickupAddress` (required: `CompanyName`, `AddressLine`, `ResidentialIndicator`, `Phone`, `City`, `CountryCode`, `ContactName`), `AlternateAddressIndicator`, `PickupPiece[]` (`ServiceCode`, `Quantity`, `DestinationCountryCode`, `ContainerCode`: `01` package, `02` UPS letter, `03` pallet), `PaymentMethod` (`00`, `01`, `03` to `07`), `Request`, optional `TotalWeight` (`Weight`, `UnitOfMeasurement` `LBS`/`KGS`) and `OverweightIndicator` |
| Create response | `PickupCreationResponse`: `Response.ResponseStatus.Code` (1 success, 0 failed), `PRN` (pickup request number, 11 characters), `RateStatus`, `RateResult` (`GrandTotalOfAllCharge`, `ChargeDetail`, `TaxCharges`, `TotalTax`) |
| Cancel | **`DELETE /shipments/{version}/pickup/{CancelBy}`**, `version = v2409`. `CancelBy`: `01` = account number, `02` = PRN. Header `Prn` is required when cancelling by PRN (the header text says length 26, the body schema says 11: **conflict, unverified**). Response `PickupCancelResponse` (`Response`, `PickupType` where `01` = on-call) |
| Other operations | `POST /shipments/{version}/pickup/{pickuptype}` (pickup rate; `pickuptype` = `oncall`, `smart`, `both`); `GET /shipments/{version}/pickup/{pickuptype}` (pending status, header `AccountNumber` required, length 6 or 10); `GET /pickup/{version}/countries/{countrycode}` (political divisions, needs `transId` and `transactionSrc`); `POST /pickup/{version}/servicecenterlocations` |
| Deprecated | `/pickupcreation/{deprecatedVersion}/pickup` and `/shipments/{deprecatedVersion}/pickup/{CancelBy}` (`v1`, `v1607`, `v1707`) |
| Retry | Create never, cancel yes (ADR-0010) |
| Source | S6 (`Pickup.yaml`) |

### 3.7 Address validation (optional `validateAddress`)

`POST /addressvalidation/{version}/{requestoption}`, `version = v2` (v1 deprecated), `requestoption` 1 = validation, 2 = classification, 3 = both. Query `regionalrequestindicator` (True/False) and `maximumcandidatelistsize` (0-50) are documented. Supported countries are limited (the spec points to an appendix table; **US and Puerto Rico street-level is the documented case, other countries unverified**). Source S7 (`AddressValidation.yaml`, title "Address Validation - Street Level"). Request and response field detail beyond this: unverified.

### 3.8 Locator / service points (optional `findServicePoints`)

`POST /locations/{version}/search/availabilities/{reqOption}`, `version = v3` (v1 deprecated), `reqOption` values 1 (drop and will-call locations), 8, 16, 24, 32, 40, 48 (and more) select location types, additional services and programs. Source S8 (`Locator.yaml`). Also `UPSPickupPoints.yaml` exists in the repo (not read). Request and response detail: unverified.

### 3.9 Paperless documents / customs upload (optional `uploadCustomsDocuments`)

| Item | Value |
|---|---|
| Upload | `POST /paperlessdocuments/{version}/upload`, `version = v2` (header `ShipperNumber` **required**) returns a Document ID |
| Push to image repository | `POST /paperlessdocuments/{version}/image` (push an uploaded document to the Forms History image repository; operation id `PushToImageRepository`) |
| Delete | `DELETE /paperlessdocuments/{version}/DocumentId/ShipperNumber` |
| Use | The returned Document ID goes into the Ship request (`ShipmentServiceOptions.InternationalForms.UserCreatedForm`) so the shipment travels paperless. Examples exist for document types `002`, `010`, `013` |
| Source | S9b (`Paperless.yaml`) |

### 3.10 Landed cost (optional `estimateLandedCost`)

`POST /landedcost/{version}/quotes`, `version = v1` (default). Headers `transId` and `transactionSrc` **required**, optional `AccountNumber`. Request: currency, shipment details (commodity ID, price, quantity, country of origin). Source S10 (`LandedCost.yaml`). Field detail: unverified. UPS also publishes `CustomsDetailV2.yaml`, `TradeDirect.yaml` and `UPSExportAssure.yaml` (not read, out of scope).

## 4. Sandbox quirks

Documented in the specs: only the CIE host differs from production (`wwwcie.ups.com` against `onlinetools.ups.com`); tracking data is retained 120 days; `transactionSrc` defaults to `testing`. Everything else below is **unverified** (no UPS page was readable and no sandbox call is allowed):

- Whether CIE returns canned tracking data only for specific test numbers, and which numbers (not stated in `Tracking.yaml`).
- Whether CIE rates equal production list rates or contain negotiated rates (Appendix B says sandbox rates are not real negotiated rates).
- Whether labels created in CIE can be voided and tracked.
- Sandbox and production credentials are separate: model them as separate carrier accounts (brief Appendix B).

## 5. Sources

| ID | Source | Retrieved | Used for |
|---|---|---|---|
| S1 | https://github.com/UPS-API/api-documentation (root listing of 45 specs, default branch head) | 2026-11-12 | Spec inventory, servers, common headers |
| S2 | https://raw.githubusercontent.com/UPS-API/api-documentation/main/OAuthClientCredentials.yaml | 2026-11-12 | Token endpoint, Basic auth, response fields, errors |
| S3 | https://raw.githubusercontent.com/UPS-API/api-documentation/main/Rating.yaml | 2026-11-12 | Rate paths, versions, request and response |
| S4 | https://raw.githubusercontent.com/UPS-API/api-documentation/main/Shipping.yaml | 2026-11-12 | Ship, void, label recovery, label formats |
| S5 | https://raw.githubusercontent.com/UPS-API/api-documentation/main/Tracking.yaml | 2026-11-12 | Track paths, headers, response |
| S6 | https://raw.githubusercontent.com/UPS-API/api-documentation/main/Pickup.yaml | 2026-11-12 | Pickup create, cancel, rate, status |
| S7 | https://raw.githubusercontent.com/UPS-API/api-documentation/main/AddressValidation.yaml | 2026-11-12 | Address validation path and version |
| S8 | https://raw.githubusercontent.com/UPS-API/api-documentation/main/Locator.yaml | 2026-11-12 | Locator path and version |
| S9 | https://www.pitneybowes.com/us/support/article/000097963/ups-oauth-token-lifespan-change.html (third party, not UPS) | 2026-11-12 | Token lifetime change 4 h to 1 h from 2026-04-01 (unverified against UPS) |
| S9b | https://raw.githubusercontent.com/UPS-API/api-documentation/main/Paperless.yaml | 2026-11-12 | Paperless document paths |
| S10 | https://raw.githubusercontent.com/UPS-API/api-documentation/main/LandedCost.yaml | 2026-11-12 | Landed cost path |
| S11 | https://developer.ups.com/api/reference/oauth/client-credentials | 2026-11-12 | **Not readable (HTTP 403)**; listed so the gap is explicit |

## 6. ADR-0010 re-verify items: result

| Item | Result |
|---|---|
| Void path `/shipments/{version}/void/cancel/{id}` | **Confirmed, but the method is `DELETE`** and `trackingnumber` is a query parameter (ADR-0010 only names the path) |
| Label recovery | **Confirmed**: `POST /labels/{version}/recovery`, default `v1` |
| Address Validation version | **`v2`** (`v1` deprecated) |
| Locator version | **`v3`** (`v1` deprecated) |
| Token lifetime | **Unverified**: spec silent; third party reports 1 h from 2026-04-01 |
| Paths already in ADR-0010 | Rating, Ship, Track, Pickup create, cancel, rate, status and OAuth: **all confirmed as written** |
| Deprecated Rating versions | `v1`, `v1601`, `v1607`, `1701`, `1707`, `v2108`, `v2205` (ADR-0010 said `v1` to `v2205`: matches) |

## 7. Open questions

1. Is a PDF label obtainable from UPS? `LabelImageFormat.Code` documents GIF, ZPL, EPL, SPL only. Decide in TASK-140: convert GIF to PDF in the adapter (preferred) or declare `labelFormats` without PDF.
2. Numeric rate limits and daily quota per app (not in specs).
3. CIE test tracking numbers and canned scenarios.
4. Whether an unknown tracking number is a 404 or a 200 with a warning.
5. `Prn` header length conflict (26 or 11) on Pickup cancel.
6. Which charge codes appear in `ItemizedCharges` and `RatedShipmentAlert` (needed for the surcharge mapping, REQ-CARR surcharge canonicalisation).
7. Address Validation country coverage beyond US and Puerto Rico; Locator coverage for India.
8. Token lifetime as served today (confirm with the first live token response).
9. Which UPS account fields are mandatory on `Shipment.Shipper.ShipperNumber` when the shipper is a Platform account billing the customer (ADR-0011).

## 8. Fixture plan per operation

Names only. All fixtures are **synthesised** (labelled `"_fixture": "synthesised"`), contain placeholder identifiers such as `<TRACKING_NUMBER_1Z>` and `<SHIPPER_NUMBER>`, and no real names, addresses, phone numbers or tokens. Layout and file names are decided by TASK-140; the case names below are the required minimum.

| Operation | Success | Typical errors | Edge cases |
|---|---|---|---|
| `oauth-token` | `token-success` (string `expires_in`), `token-success-short-lifetime` | `token-400-invalid-request`, `token-401-unauthorized`, `token-403-blocked-merchant`, `token-429-quota` | `token-expires-in-as-string`, `token-401-on-api-call-then-refresh` |
| `rate` | `rate-shoptimeintransit-us-in-3-services`, `rate-rate-single-service`, `rate-negotiated-rates` | `rate-400-invalid-postal-code`, `rate-400-no-service-available`, `rate-401-expired-token`, `rate-403-blocked`, `rate-429`, `rate-503` | `rate-unmapped-service-code`, `rate-unmapped-surcharge`, `rate-multi-package`, `rate-dim-weight-over-actual`, `rate-ratedshipment-single-object-not-array`, `rate-no-negotiated-rates-block`, `rate-timeout` |
| `ship` | `ship-gif-label-single-package`, `ship-zpl-label`, `ship-multi-package`, `ship-international-with-forms` | `ship-400-invalid-address`, `ship-400-service-not-available`, `ship-401`, `ship-403`, `ship-429`, `ship-500-ambiguous`, `ship-timeout-ambiguous` | `ship-alert-array-vs-object`, `ship-label-missing-graphicimage`, `ship-paperless-document-id` |
| `void` | `void-success-all-packages`, `void-success-partial-packages` | `void-400-already-voided`, `void-400-not-found`, `void-403`, `void-429` | `void-after-pickup-created`, `void-packagelevelresults-single-object` |
| `label-recovery` | `label-recovery-success` | `label-recovery-400-not-found` | `label-recovery-after-failed-download` |
| `track` | `track-delivered`, `track-in-transit`, `track-out-for-delivery`, `track-label-created`, `track-exception`, `track-returned` | `track-404-not-found`, `track-400-invalid-number`, `track-403`, `track-429`, `track-503` | `track-warning-no-info`, `track-signature-redaction`, `track-pod-base64-redaction`, `track-missing-gmt-offset`, `track-delivered-then-activity-order`, `track-multi-package-shipment` |
| `pickup-create` | `pickup-create-success-with-rate`, `pickup-create-success-no-rate` | `pickup-create-400-past-date`, `pickup-create-400-closed-window`, `pickup-create-429`, `pickup-create-500-ambiguous` | `pickup-create-residential`, `pickup-create-weekend` |
| `pickup-cancel` | `pickup-cancel-by-prn-success`, `pickup-cancel-by-account-success` | `pickup-cancel-400-already-cancelled`, `pickup-cancel-400-unknown-prn` | `pickup-cancel-prn-length-variant` |
| `address-validation` (optional) | `av-valid`, `av-ambiguous-candidates` | `av-400-unsupported-country` | `av-residential-classification`, `av-no-candidates` |
| `locator` (optional) | `locator-access-points` | `locator-400-invalid-location` | `locator-empty-result` |
| `paperless-upload` (optional) | `paperless-upload-success` | `paperless-400-unsupported-format`, `paperless-400-too-large` | `paperless-push-image-after-ship` |
| `landed-cost` (optional) | `landed-cost-success-india` | `landed-cost-400-invalid-hs`, `landed-cost-429` | `landed-cost-partial-charges` |
