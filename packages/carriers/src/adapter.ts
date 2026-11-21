/**
 * The `CarrierAdapter` contract (REQ-CARR-001, brief §4.3, ADR-0010 §Interface; `recoverLabel` ADR-0010 am. 11 item 3).
 * One interface, many adapters: onboarding a carrier needs only an adapter, a capability declaration and seed data.
 * Every operation takes canonical types and a `CarrierContext`; nothing outside `packages/carriers` sees a wire format.
 * Adapters are not called directly: `createCarrierRegistry` validates them and hands out guarded instances
 * (registry.ts, guard.ts), which the resilience wrapper (TASK-132) then wraps per account.
 */
import type { CarrierCapabilities } from './capabilities.js';
import type {
  Address,
  AddressValidation,
  CancelResult,
  CarrierShipmentRef,
  LabelDocument,
  LandedCost,
  LandedCostRequest,
  PaperlessRequest,
  PickupConfirmation,
  PickupRef,
  PickupRequest,
  RateRequest,
  RateResponse,
  ServicePoint,
  ServicePointQuery,
  ShipmentConfirmation,
  ShipmentRequest,
  TrackingResult,
} from './canonical/types.js';
import type { DocumentFormat } from './canonical/codes.js';
import type { CarrierContext } from './context.js';

export interface CarrierAdapter {
  /** `carriers.code`: `DHL_EXPRESS`, `FEDEX`, `UPS`, `MOCK`, ... */
  readonly code: string;
  /** The mandatory capability declaration (REQ-CARR-002); pure, no I/O, the same value on every call. */
  capabilities(): CarrierCapabilities;

  getRates(req: RateRequest, ctx: CarrierContext): Promise<RateResponse>;
  createShipment(req: ShipmentRequest, ctx: CarrierContext): Promise<ShipmentConfirmation>;
  /** Required, but may be declared unsupported (`operations.cancelShipment = false`, DHL Express, D-ARCH-057). */
  cancelShipment(ref: CarrierShipmentRef, ctx: CarrierContext): Promise<CancelResult>;
  schedulePickup(req: PickupRequest, ctx: CarrierContext): Promise<PickupConfirmation>;
  cancelPickup(ref: PickupRef, ctx: CarrierContext): Promise<CancelResult>;
  track(trackingNumbers: readonly string[], ctx: CarrierContext): Promise<TrackingResult[]>;

  validateAddress?(address: Address, ctx: CarrierContext): Promise<AddressValidation>;
  findServicePoints?(query: ServicePointQuery, ctx: CarrierContext): Promise<ServicePoint[]>;
  uploadCustomsDocuments?(req: PaperlessRequest, ctx: CarrierContext): Promise<void>;
  /** Seam only in this run (REQ-CARR-001 note). */
  estimateLandedCost?(req: LandedCostRequest, ctx: CarrierContext): Promise<LandedCost>;
  /**
   * Fetches a created shipment's label in formats the create call could not return (REQ-DOC-002; UPS Label Recovery).
   * Idempotent and retryable, `transactional` pool; never a second `createShipment` (zero duplicate labels).
   */
  recoverLabel?(ref: CarrierShipmentRef, formats: readonly DocumentFormat[], ctx: CarrierContext): Promise<LabelDocument[]>;
}

/** A registered adapter: every declared operation is present, and answers `CAPABILITY_NOT_SUPPORTED` when unsupported. */
export type GuardedCarrierAdapter = Readonly<Required<CarrierAdapter>>;
