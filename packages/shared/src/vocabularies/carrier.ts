/**
 * Carrier canonical vocabularies that leave the carrier layer (REQ-CARR-007, DR-B30, DR-B18, data-model enums; ADR-0010
 * amendment 12 item 2, D-TASK075-02, D-ARCH-168; TASK-080). The API, the worker and the browser apps read surcharge
 * lines, carrier error codes, tracking statuses and label formats, so the lists live on the browser-safe side of
 * `@platform/shared` (the root; never `./logging` or `./queues`, which are Node-only). `packages/carriers` re-exports
 * each list from `canonical/codes.ts`, so no adapter import changes; the carrier-only lists (service tiers, directions,
 * content and package types, incoterms, environments) and the port's request and response types stay there.
 *
 * Parity: `carrier.test.ts` compares each list with its OpenAPI enum element for element (and at compile time with
 * `types.gen.ts`), except the surcharge codes, which have no OpenAPI enum (a charge line `code` is free text): they stay
 * pinned to the DR-B30 row by `packages/carriers/src/canonical/codes.test.ts` (D-TASK080-12).
 */

/** DR-B30 surcharge codes. `CARRIER_OTHER` is the landing code of an unmapped carrier surcharge (raw label kept). */
export const SURCHARGE_CODES = [
  'FUEL',
  'REMOTE_AREA',
  'RESIDENTIAL',
  'OVERSIZE',
  'OVERWEIGHT',
  'PEAK',
  'EMERGENCY',
  'SIGNATURE',
  'ADDITIONAL_HANDLING',
  'PICKUP_FEE',
  'DUTIES_TAXES_ESTIMATE',
  'CARRIER_OTHER',
] as const;
export type SurchargeCode = (typeof SURCHARGE_CODES)[number];

/** DR-B30 error codes (OpenAPI `CarrierErrorCode`). `CARRIER_UNKNOWN_ERROR` is the landing code of an unmapped error. */
export const CARRIER_ERROR_CODES = [
  'INVALID_ADDRESS',
  'POSTCODE_INVALID',
  'SERVICE_UNAVAILABLE',
  'WEIGHT_EXCEEDED',
  'DIMENSION_EXCEEDED',
  'PROHIBITED_ITEM',
  'CUSTOMS_DATA_INVALID',
  'AUTH_FAILED',
  'RATE_LIMITED',
  'TIMEOUT',
  'CARRIER_UNAVAILABLE',
  'CARRIER_BUSY',
  'DUPLICATE_SHIPMENT',
  'CANNOT_VOID',
  'PICKUP_UNAVAILABLE',
  'CAPABILITY_NOT_SUPPORTED',
  'CARRIER_UNKNOWN_ERROR',
] as const;
export type CarrierErrorCode = (typeof CARRIER_ERROR_CODES)[number];

/** DR-B18 / data-model `tracking_status` (OpenAPI `TrackingStatus`): the canonical tracking taxonomy. */
export const TRACKING_STATUSES = [
  'INFO_RECEIVED',
  'PICKED_UP',
  'DROPPED_OFF',
  'IN_TRANSIT',
  'CUSTOMS_HOLD',
  'CUSTOMS_CLEARED',
  'OUT_FOR_DELIVERY',
  'DELIVERY_ATTEMPTED',
  'DELIVERED',
  'EXCEPTION',
  'RETURN_INITIATED',
  'RETURNED_TO_SENDER',
  'CANCELLED',
] as const;
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

/**
 * Data-model `document_format` (REQ-DOC-002/015; OpenAPI `Document.format` and `CarrierService.label_formats`). The
 * only formats a label may carry: raster carrier output (GIF, PNG, EPL, SPL) never leaves an adapter except as a
 * raw-payload `$blob` (ADR-0010 am. 11 item 3).
 */
export const DOCUMENT_FORMATS = ['PDF_4X6', 'PDF_A4', 'PDF_LETTER', 'ZPL'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

const memberOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);

export const isSurchargeCode = memberOf(SURCHARGE_CODES);
export const isCarrierErrorCode = memberOf(CARRIER_ERROR_CODES);
export const isTrackingStatus = memberOf(TRACKING_STATUSES);
export const isDocumentFormat = memberOf(DOCUMENT_FORMATS);
