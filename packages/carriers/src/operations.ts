/**
 * The operations of the `CarrierAdapter` contract (REQ-CARR-001, brief §4.3, ADR-0010 §Interface and am. 11 item 3).
 * The six required operations stay required even where a carrier cannot perform one (`cancelShipment` on DHL Express
 * is declared unsupported through `capabilities().operations.cancelShipment`, D-ARCH-057); the optional ones are
 * declared per adapter in `capabilities().operations`.
 */
export const REQUIRED_OPERATIONS = ['getRates', 'createShipment', 'cancelShipment', 'schedulePickup', 'cancelPickup', 'track'] as const;
export type RequiredOperation = (typeof REQUIRED_OPERATIONS)[number];

export const OPTIONAL_OPERATIONS = [
  'validateAddress',
  'findServicePoints',
  'uploadCustomsDocuments',
  'estimateLandedCost',
  'recoverLabel',
] as const;
export type OptionalOperation = (typeof OPTIONAL_OPERATIONS)[number];

/**
 * Operations whose support is declared in `capabilities().operations`: every optional operation plus the one required
 * operation a carrier may lack (`cancelShipment`, ADR-0010 am. 11 item 2). The capability guard answers each of them
 * with `CAPABILITY_NOT_SUPPORTED`, without network I/O, when declared `false`.
 */
export const DECLARED_OPERATIONS = [...OPTIONAL_OPERATIONS, 'cancelShipment'] as const;
export type DeclaredOperation = (typeof DECLARED_OPERATIONS)[number];

export const CARRIER_OPERATIONS = [...REQUIRED_OPERATIONS, ...OPTIONAL_OPERATIONS] as const;
export type CarrierOperation = (typeof CARRIER_OPERATIONS)[number];

/**
 * Bulkhead pool per operation (ADR-0010 am. 1; `recoverLabel` am. 11 item 3). `track` is listed under `transactional`
 * for booked shipments; the gateway (TASK-132) decides per call. Consumed by the resilience wrapper.
 */
export const OPERATION_POOL: Readonly<Record<CarrierOperation, 'rates' | 'transactional'>> = Object.freeze({
  getRates: 'rates',
  findServicePoints: 'rates',
  validateAddress: 'rates',
  estimateLandedCost: 'rates',
  createShipment: 'transactional',
  cancelShipment: 'transactional',
  schedulePickup: 'transactional',
  cancelPickup: 'transactional',
  uploadCustomsDocuments: 'transactional',
  track: 'transactional',
  recoverLabel: 'transactional',
});

/**
 * Operations that are safe to retry (ADR-0010 §Resilience wrapper; `recoverLabel` is idempotent, am. 11 item 3).
 * `createShipment` and `schedulePickup` are never retried (REQ-CARR-017).
 */
export const IDEMPOTENT_OPERATIONS: ReadonlySet<CarrierOperation> = new Set<CarrierOperation>([
  'getRates',
  'track',
  'findServicePoints',
  'validateAddress',
  'cancelShipment',
  'cancelPickup',
  'recoverLabel',
]);
