# Mock carrier (deterministic, no network)

Code `MOCK`; services `MOCK_EXPRESS` (1-3 transit days), `MOCK_STANDARD` (3-5), `MOCK_ECONOMY` (5-9). REQ-CARR-004, US-122, ADR-0010 §Mock carrier. It needs no credentials and makes no network call: `EGRESS` is empty in both environments.

| Area | Behaviour |
|---|---|
| Rates | Pure function of billable weight (max of actual and volumetric, summed, rounded up to 500 g), lane zone (`zones.ts`) and service, on integer USD minor units, plus a 12 % `FUEL` surcharge. Nothing else (content type, ship date, residential, account) moves the price. A request beyond the limits (70 kg per package, 300 kg per shipment, 1200 x 800 x 800 mm) returns no quotes with `noServiceReason` `WEIGHT_EXCEEDED` or `DIMENSION_EXCEEDED`, never an exception |
| Create | Tracking number `MOCK` plus 12 digits derived from the client reference, so the same reference gives the same number and a byte-identical label. Labels are generated PDF (`PDF_4X6`, `PDF_A4`, `PDF_LETTER`) and ZPL carrying "MOCK - NOT A VALID LABEL"; the adapter returns raw `{ format, content }` and the capability guard re-checks them |
| Cancel, pickup | Stateless: a Mock number can be cancelled; pickups are served Monday to Friday, 08:00-18:00, window of at least 120 minutes, otherwise `PICKUP_UNAVAILABLE` |
| Track | Baseline happy path (`INFO_RECEIVED` to `DELIVERED`) from a fixed anchor, never from a clock; a number the Mock did not issue is `found: false`. Scenario variants are TASK-097's |
| Optional operations | `validateAddress`, `findServicePoints`, `uploadCustomsDocuments`, `recoverLabel` supported; `estimateLandedCost` declared unsupported |
| Call log | Every operation emits exactly one `carrier.call` line through `outboundCallFields` (correlation ID, no body) and keeps a bounded `callRecords()` list carrying the same correlation ID |
| Latency hook | `latency=<0..30000>` in `CarrierContext.mockScenario` delays every call, only when the composition root passes `scenariosEnabled` (`MOCK_SCENARIOS_ENABLED`); other directives and the production exclusion are TASK-097's |

Registration: the composition root passes `createMockAdapter({ logger, scenariosEnabled })` to `createCarrierRegistry` only when `MOCK_CARRIER_ENABLED` is true. Time enters through the injected `monotonicMs` and `sleep` seams only. Tests live beside the sources (`*.test.ts`) because the package `tsconfig.json` includes `src` only.
