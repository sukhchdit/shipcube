/**
 * Platform canonical vocabularies of the carrier layer (REQ-CARR-007, DR-B30, DR-B18, data-model enums; ADR-0010
 * §Interface). Everything that leaves an adapter speaks these codes only: the rest of the system and every customer
 * message depend on them, never on carrier wording. The lists are the single source the normalisers validate their
 * mapping tables against (AT-US-124-05); codes.test.ts pins them to the DR-B30 row of REQUIREMENTS.md, so the catalogue
 * and the requirement cannot drift apart silently.
 *
 * The surcharge codes, carrier error codes, tracking statuses and document formats live in `@platform/shared` (the
 * browser-safe root; ADR-0010 am. 12 item 2, D-TASK075-02, D-ARCH-168; TASK-080), because the API and the apps read them
 * too. They are re-exported here unchanged, so no adapter import changes.
 */
import type { CarrierErrorCode } from '@platform/shared';

export {
  CARRIER_ERROR_CODES,
  type CarrierErrorCode,
  DOCUMENT_FORMATS,
  type DocumentFormat,
  isCarrierErrorCode,
  isDocumentFormat,
  isSurchargeCode,
  isTrackingStatus,
  SURCHARGE_CODES,
  type SurchargeCode,
  TRACKING_STATUSES,
  type TrackingStatus,
} from '@platform/shared';

/** DR-B30 service tiers. */
export const SERVICE_TIERS = ['EXPRESS', 'STANDARD', 'ECONOMY'] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

/** Data-model `direction` (REQ-BOOK-027). */
export const DIRECTIONS = ['EXPORT', 'IMPORT', 'DOMESTIC'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Data-model `content_type` (REQ-BOOK-028). */
export const CONTENT_TYPES = ['DOCUMENT', 'PARCEL'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** Data-model `package_type` (REQ-BOOK-028; `PALLET`/`FREIGHT` are later seams). */
export const PACKAGE_TYPES = ['PARCEL_BOX', 'ENVELOPE'] as const;
export type PackageType = (typeof PACKAGE_TYPES)[number];

/** Incoterms the Platform offers (REQ-CUST-005: DAP by default, DDP where the service declares it). */
export const INCOTERMS = ['DAP', 'DDP'] as const;
export type Incoterm = (typeof INCOTERMS)[number];

/** Carrier account environment: a property of the account, never a global flag (REQ-CARR-001, brief §4.3). */
export const CARRIER_ENVIRONMENTS = ['sandbox', 'production'] as const;
export type CarrierEnvironment = (typeof CARRIER_ENVIRONMENTS)[number];

/** Carrier code shape (data-model `carriers.code` CHECK). */
export const CARRIER_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/u;
/**
 * A carrier's own service code as it may appear inside a canonical service code: letters, digits, `_` and `-`, 1..32
 * characters. A code outside this shape cannot be mapped (it is dropped and logged like any unmapped service).
 */
export const CARRIER_SERVICE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u;

const memberOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);

export const isServiceTier = memberOf(SERVICE_TIERS);
export const isDirection = memberOf(DIRECTIONS);
export const isContentType = memberOf(CONTENT_TYPES);
export const isCarrierEnvironment = memberOf(CARRIER_ENVIRONMENTS);
export const isPackageType = memberOf(PACKAGE_TYPES);
export const isIncoterm = memberOf(INCOTERMS);

export const isCarrierCode = (value: unknown): value is string => typeof value === 'string' && CARRIER_CODE_PATTERN.test(value);

/**
 * DR-B30: canonical service code = carrier code plus the carrier's service code (`MOCK` + `EXPRESS` -> `MOCK_EXPRESS`,
 * `DHL_EXPRESS` + `P` -> `DHL_EXPRESS_P`). Throws on a shape that cannot form a canonical code.
 */
export function canonicalServiceCode(carrierCode: string, carrierServiceCode: string): string {
  if (!isCarrierCode(carrierCode)) throw new TypeError(`invalid carrier code ${JSON.stringify(carrierCode)}`);
  if (!CARRIER_SERVICE_CODE_PATTERN.test(carrierServiceCode)) {
    throw new TypeError(`invalid service code ${JSON.stringify(carrierServiceCode)} for carrier ${carrierCode}`);
  }
  return `${carrierCode}_${carrierServiceCode.toUpperCase()}`;
}

/**
 * English customer-facing text per canonical error code (REQ-CARR-007: customer messages come from the canonical code,
 * never from raw carrier text). Clients localise from the i18n key `carrierErrors.<CODE>`; this text is the fallback
 * and the `message` of a `CarrierError`.
 */
export const CARRIER_ERROR_MESSAGES: Readonly<Record<CarrierErrorCode, string>> = Object.freeze({
  INVALID_ADDRESS: 'The carrier could not validate the address.',
  POSTCODE_INVALID: 'The postal code is not valid for this country.',
  SERVICE_UNAVAILABLE: 'The carrier service is not available for this shipment.',
  WEIGHT_EXCEEDED: 'The shipment exceeds the carrier weight limit.',
  DIMENSION_EXCEEDED: 'The shipment exceeds the carrier size limit.',
  PROHIBITED_ITEM: 'The carrier does not accept this content.',
  CUSTOMS_DATA_INVALID: 'The customs information was rejected by the carrier.',
  AUTH_FAILED: 'The carrier rejected the account credentials.',
  RATE_LIMITED: 'The carrier is limiting requests; try again shortly.',
  TIMEOUT: 'The carrier did not answer in time.',
  CARRIER_UNAVAILABLE: 'The carrier is currently unavailable.',
  CARRIER_BUSY: 'The carrier is busy; try again shortly.',
  DUPLICATE_SHIPMENT: 'The carrier already holds this shipment.',
  CANNOT_VOID: 'The carrier can no longer void this shipment.',
  PICKUP_UNAVAILABLE: 'No pickup is available for the requested date and window.',
  CAPABILITY_NOT_SUPPORTED: 'The carrier does not support this operation.',
  CARRIER_UNKNOWN_ERROR: 'The carrier reported an error.',
});

/** i18n key of the customer-facing message of a canonical error code. */
export const carrierErrorMessageKey = (code: CarrierErrorCode): `carrierErrors.${CarrierErrorCode}` => `carrierErrors.${code}`;
