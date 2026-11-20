/**
 * Canonical request and response types of the `CarrierAdapter` contract (brief §4.3, ADR-0010 §Interface). Types only.
 * Every value is a Platform canonical code (codes.ts) or a unit-normalised quantity: weights in grams and lengths in
 * millimetres as integers (DR-B15), money as integer minor units with an ISO 4217 code (no floating point on money).
 * Carrier wire formats live inside their adapter folder and are never exported from the package (REQ-CARR-001).
 */
import type {
  CarrierErrorCode,
  ContentType,
  Direction,
  DocumentFormat,
  Incoterm,
  PackageType,
  ServiceTier,
  SurchargeCode,
  TrackingStatus,
} from './codes.js';

/** Integer minor units with an ISO 4217 currency (`{ amountMinor: 12345, currency: 'USD' }` = USD 123.45). */
export interface CarrierMoney {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface Address {
  readonly countryCode: string;
  readonly postalCode?: string;
  readonly city?: string;
  readonly stateCode?: string;
  readonly lines?: readonly string[];
  readonly residential?: boolean;
}

/** A party of a shipment (personal data: never logged, redacted in raw payloads, ADR-0010 am. 8). */
export interface Party {
  readonly name: string;
  readonly company?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly address: Address;
}

export interface PackageSpec {
  readonly packageType: PackageType;
  readonly weightG: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
}

export interface RateRequest {
  readonly origin: Address;
  readonly destination: Address;
  readonly packages: readonly PackageSpec[];
  readonly contentType: ContentType;
  readonly direction: Direction;
  /** ISO date (YYYY-MM-DD) in the sender's zone. */
  readonly shipDate: string;
  /** Declared customs value for dutiable shipments. */
  readonly declaredValue?: CarrierMoney;
  /** Duties payer to price for (REQ-CUST-005); DAP when absent. */
  readonly incoterm?: Incoterm;
}

/** One canonical surcharge line. `raw` keeps the carrier's original label of a `CARRIER_OTHER` line (REQ-CARR-007). */
export interface SurchargeLine {
  readonly code: SurchargeCode;
  readonly amount: CarrierMoney;
  readonly raw?: string;
}

/** One priced, canonical service of a carrier answer. */
export interface RateQuote {
  /** DR-B30 canonical service code (carrier code plus the carrier's service code). */
  readonly serviceCode: string;
  readonly tier: ServiceTier;
  readonly baseCharge: CarrierMoney;
  readonly surcharges: readonly SurchargeLine[];
  readonly totalCharge: CarrierMoney;
  readonly transitDaysMin?: number;
  readonly transitDaysMax?: number;
  /** ISO 8601 estimated delivery, when the carrier states one. */
  readonly estimatedDelivery?: string;
}

/**
 * A `getRates` answer. `quotes` is the brief's `RateQuote[]`; an empty `quotes` is the per-carrier status NO_SERVICE
 * (REQ-CARR-008), and `noServiceReason` may say why (US-122: a request outside the carrier's limits returns no services
 * with reason WEIGHT_EXCEEDED, not an exception). It is meaningful only when `quotes` is empty; the TASK-101 contract
 * suite (REQ-CARR-011) asserts that invariant per adapter.
 */
export interface RateResponse {
  readonly quotes: readonly RateQuote[];
  readonly noServiceReason?: CarrierErrorCode;
}

export interface CustomsItem {
  readonly description: string;
  readonly quantity: number;
  readonly unitValue: CarrierMoney;
  readonly unitWeightG: number;
  readonly hsCode?: string;
  readonly originCountryCode: string;
}

export interface ShipmentRequest {
  /** Platform client reference; idempotency key of carriers that declare `idempotentCreate` (DR-B04 G2). */
  readonly clientReference: string;
  readonly serviceCode: string;
  readonly shipper: Party;
  readonly recipient: Party;
  readonly packages: readonly PackageSpec[];
  readonly contentType: ContentType;
  readonly direction: Direction;
  readonly shipDate: string;
  /** Duties payer (REQ-CUST-005): DAP by default, DDP only where the service declares `ddp`. */
  readonly incoterm: Incoterm;
  /** Formats requested; an adapter returns only document formats (REQ-DOC-002). */
  readonly labelFormats: readonly DocumentFormat[];
  readonly customsItems?: readonly CustomsItem[];
  readonly customerReference?: string;
}

/**
 * A label or document as bytes in a `document_format` (ADR-0010 am. 11 items 3 and 6). There is no URL field by
 * design: carrier-supplied URLs are never dereferenced and never shown to users. Build through `createLabelDocument`.
 */
export interface LabelDocument {
  readonly format: DocumentFormat;
  readonly content: Uint8Array;
}

/** Identifies a created carrier shipment. */
export interface CarrierShipmentRef {
  readonly trackingNumber: string;
  /** Carrier-side shipment identifier when it differs from the tracking number. */
  readonly carrierShipmentId?: string;
  readonly clientReference?: string;
}

/** Piece-level result of a create call (data-model `shipment_packages.tracking_number`, `carrier_package_ref`). */
export interface ShipmentPackageResult {
  /** 1-based position of the package in `ShipmentRequest.packages`. */
  readonly seq: number;
  readonly trackingNumber?: string;
  readonly carrierPackageRef?: string;
}

export interface ShipmentConfirmation {
  readonly ref: CarrierShipmentRef;
  readonly serviceCode: string;
  /** Labels the create call returned; a format missing here is obtained through `recoverLabel` (REQ-DOC-002). */
  readonly labels: readonly LabelDocument[];
  /** Per-package references, for carriers that return piece-level numbers (multi-package UPS/FedEx shipments). */
  readonly packages?: readonly ShipmentPackageResult[];
  readonly charge?: CarrierMoney;
}

export interface CancelResult {
  readonly cancelled: boolean;
  /** Canonical reason when `cancelled` is false (`CANNOT_VOID`, `PICKUP_UNAVAILABLE`, ...). */
  readonly reason?: CarrierErrorCode;
}

export interface PickupRequest {
  readonly shipments: readonly CarrierShipmentRef[];
  readonly address: Address;
  readonly contact: Party;
  /** ISO date (YYYY-MM-DD) in `timeZone`. */
  readonly date: string;
  /** HH:MM local times in `timeZone`. */
  readonly readyTime: string;
  readonly closeTime: string;
  /** IANA zone of the pickup address. */
  readonly timeZone: string;
}

export interface PickupRef {
  readonly confirmationNumber: string;
  readonly date: string;
}

export interface PickupConfirmation {
  readonly ref: PickupRef;
  readonly readyTime: string;
  readonly closeTime: string;
}

/**
 * A tracking event (REQ-TRACK-001/005). An event whose carrier code has no mapping is kept as `IN_TRANSIT` with
 * `unmapped: true`, never dropped (US-241). Location is city level at most (guardrail: no personal data beyond city on
 * public tracking).
 */
export interface TrackingEvent {
  readonly status: TrackingStatus;
  /** True when the carrier code had no canonical mapping (status is then `IN_TRANSIT`; TASK-168 meters it). */
  readonly unmapped: boolean;
  /** ISO 8601 with offset where the carrier gives one. */
  readonly occurredAt: string;
  readonly city?: string;
  readonly countryCode?: string;
  /** The carrier's own event code (diagnosis only). */
  readonly carrierEventCode?: string;
  /** The carrier's event identifier: the REQ-TRACK-005 de-duplication key. */
  readonly carrierEventId?: string;
  /**
   * The carrier's original description (data-model `carrier_description`). Personal data (it may name a signatory or a
   * street): never logged, never shown on public tracking (DR-B31), stored for staff only.
   */
  readonly carrierDescription?: string;
}

export interface TrackingResult {
  readonly trackingNumber: string;
  /** False for a number the carrier does not know (`track=unknown_number`). */
  readonly found: boolean;
  readonly events: readonly TrackingEvent[];
}

export interface AddressValidation {
  readonly valid: boolean;
  readonly suggestions: readonly Address[];
  readonly reason?: CarrierErrorCode;
}

export interface ServicePointQuery {
  readonly address: Address;
  readonly radiusM?: number;
  readonly limit?: number;
}

export interface ServicePoint {
  readonly id: string;
  readonly name: string;
  readonly address: Address;
  readonly distanceM?: number;
}

export interface PaperlessRequest {
  readonly ref: CarrierShipmentRef;
  readonly documents: readonly { readonly documentType: string; readonly content: Uint8Array }[];
}

/** `estimateLandedCost` is a seam only in this run (REQ-CARR-001 note). */
export interface LandedCostRequest {
  readonly rate: RateRequest;
  readonly items: readonly CustomsItem[];
}

export interface LandedCost {
  readonly duties: CarrierMoney;
  readonly taxes: CarrierMoney;
  readonly total: CarrierMoney;
}
