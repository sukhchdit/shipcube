/**
 * The mandatory capability declaration of every adapter (REQ-CARR-002, ADR-0010 §Interface and am. 11 items 1-3). It
 * says which declared operations the adapter supports (a boolean for every optional operation and for
 * `cancelShipment`), what each service accepts, and the carrier-level tracking, idempotency and pickup facts. It is the
 * single input of the capability guard (guard.ts) and of eligibility in rate shopping (DR-B34); `capabilityIssues`
 * rejects a malformed declaration at registration, so a guard decision never rests on a missing or non-boolean flag.
 */
import {
  type ContentType,
  type Direction,
  type DocumentFormat,
  type ServiceTier,
  CONTENT_TYPES,
  DIRECTIONS,
  DOCUMENT_FORMATS,
  SERVICE_TIERS,
  canonicalServiceCode,
  isContentType,
  isDirection,
  isDocumentFormat,
  isServiceTier,
} from './canonical/codes.js';
import { DECLARED_OPERATIONS, type DeclaredOperation } from './operations.js';

/** A boolean for each declared operation: every optional operation plus `cancelShipment`. */
export type OperationSupport = Readonly<Record<DeclaredOperation, boolean>>;

export interface DimensionsMm {
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
}

/** Volumetric divisor per unit system: cm³/kg (metric, default 5000) and in³/lb (imperial, default 139). */
export interface VolumetricDivisors {
  readonly metric: number;
  readonly imperial: number;
}

/** Booking cut-off: a local time of day (HH:MM) in an IANA zone (DR-B25). */
export interface BookingCutoff {
  readonly localTime: string;
  readonly timeZone: string;
}

export interface ServiceCapability {
  /** DR-B30 canonical service code = carrier code plus `carrierServiceCode`. */
  readonly canonicalCode: string;
  readonly carrierServiceCode: string;
  readonly tier: ServiceTier;
  readonly directions: readonly Direction[];
  readonly contentTypes: readonly ContentType[];
  readonly maxPackageWeightG: number;
  readonly maxShipmentWeightG: number;
  readonly maxDimensionsMm: DimensionsMm;
  readonly volumetricDivisor: VolumetricDivisors;
  readonly bookingCutoff: BookingCutoff;
  readonly dropoff: boolean;
  readonly pickup: boolean;
  readonly ddp: boolean;
  readonly paperless: boolean;
  /** Offered label formats, `document_format` values only (REQ-DOC-002). */
  readonly labelFormats: readonly DocumentFormat[];
}

/** Pickup constraints (REQ-CARR-002, D-014); there is no pickup-availability query (GAP-B-01). */
export interface PickupConstraints {
  /** ISO weekdays served, 1 (Monday) .. 7 (Sunday). */
  readonly daysServed: readonly number[];
  /** HH:MM earliest ready time. */
  readonly earliestReady: string;
  /** HH:MM latest close time. */
  readonly latestClose: string;
  readonly minWindowMinutes: number;
}

export interface CarrierCapabilities {
  readonly operations: OperationSupport;
  readonly services: readonly ServiceCapability[];
  readonly maxTrackingNumbersPerCall: number;
  readonly pushTracking: boolean;
  /** Whether `createShipment` is idempotent by client reference (DR-B04 G2). */
  readonly idempotentCreate: boolean;
  readonly pickup: PickupConstraints;
}

/** Upper bound of `maxTrackingNumbersPerCall` (DHL batch tracking takes 200, ADR-0010 am. 11 item 1). */
export const MAX_TRACKING_NUMBERS_PER_CALL_LIMIT = 1000;

const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const IANA_ZONE = /^(?:UTC|[A-Z][A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/u;

const isPositiveInt = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * IANA areas. ICU lists its own canonical spellings (`Asia/Calcutta`, not `Asia/Kolkata`), and the formatting API that
 * would resolve aliases is reserved to the shared format helpers (platform/no-tofixed-tolocalestring), so a name is
 * accepted when ICU lists it or when it is an Area/Location name under a real IANA area. The zone reference data
 * (TASK-124) is the authority on the exact set.
 */
const IANA_AREAS: ReadonlySet<string> = new Set([
  'Africa',
  'America',
  'Antarctica',
  'Arctic',
  'Asia',
  'Atlantic',
  'Australia',
  'Europe',
  'Indian',
  'Pacific',
  'Etc',
]);
let zones: ReadonlySet<string> | undefined;
/** The runtime's IANA zone names, read once. */
const knownZones = (): ReadonlySet<string> => (zones ??= new Set(Intl.supportedValuesOf('timeZone')));

/** Minutes after midnight of an HH:MM value, or undefined when malformed. */
export function minutesOfDay(value: unknown): number | undefined {
  if (typeof value !== 'string' || !LOCAL_TIME.test(value)) return undefined;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

/** True for an IANA zone name (`Europe/London`, `Asia/Kolkata`, `UTC`); offsets and unknown areas are refused. */
export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !IANA_ZONE.test(value)) return false;
  return value === 'UTC' || knownZones().has(value) || IANA_AREAS.has(value.slice(0, value.indexOf('/')));
}

function enumListIssues(path: string, value: unknown, isMember: (v: unknown) => boolean, allowed: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) return [`${path} must be a non-empty array of ${allowed.join(' | ')}`];
  const issues: string[] = [];
  value.forEach((entry, index) => {
    if (!isMember(entry)) issues.push(`${path}[${String(index)}] must be one of ${allowed.join(' | ')}`);
  });
  if (new Set(value).size !== value.length) issues.push(`${path} has duplicates`);
  return issues;
}

function positiveIntIssues(path: string, record: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter((key) => !isPositiveInt(record[key])).map((key) => `${path}.${key} must be a positive integer`);
}

function booleanIssues(path: string, record: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter((key) => typeof record[key] !== 'boolean').map((key) => `${path}.${key} must be a boolean`);
}

function operationsIssues(operations: unknown): string[] {
  if (!isRecord(operations)) return ['operations must be an object with a boolean per declared operation'];
  const issues = DECLARED_OPERATIONS.filter((operation) => typeof operations[operation] !== 'boolean').map(
    (operation) => `operations.${operation} must be a boolean`,
  );
  const known = new Set<string>(DECLARED_OPERATIONS);
  for (const key of Object.keys(operations)) if (!known.has(key)) issues.push(`operations.${key} is not a declared operation`);
  return issues;
}

function serviceIssues(service: unknown, path: string, carrierCode: string): string[] {
  if (!isRecord(service)) return [`${path} must be an object`];
  const issues: string[] = [];
  const { canonicalCode, carrierServiceCode, tier, maxDimensionsMm, volumetricDivisor, bookingCutoff } = service;
  let expected: string | undefined;
  try {
    expected = typeof carrierServiceCode === 'string' ? canonicalServiceCode(carrierCode, carrierServiceCode) : undefined;
  } catch {
    expected = undefined;
  }
  if (expected === undefined) issues.push(`${path}.carrierServiceCode is not a valid carrier service code`);
  else if (canonicalCode !== expected) issues.push(`${path}.canonicalCode must be ${expected} (DR-B30: carrier code plus service code)`);
  if (!isServiceTier(tier)) issues.push(`${path}.tier must be one of ${SERVICE_TIERS.join(' | ')}`);
  issues.push(
    ...enumListIssues(`${path}.directions`, service.directions, isDirection, DIRECTIONS),
    ...enumListIssues(`${path}.contentTypes`, service.contentTypes, isContentType, CONTENT_TYPES),
    ...enumListIssues(`${path}.labelFormats`, service.labelFormats, isDocumentFormat, DOCUMENT_FORMATS),
    ...positiveIntIssues(path, service, ['maxPackageWeightG', 'maxShipmentWeightG']),
    ...booleanIssues(path, service, ['dropoff', 'pickup', 'ddp', 'paperless']),
  );
  if (isPositiveInt(service.maxPackageWeightG) && isPositiveInt(service.maxShipmentWeightG)) {
    if (service.maxShipmentWeightG < service.maxPackageWeightG) issues.push(`${path}.maxShipmentWeightG must be >= maxPackageWeightG`);
  }
  if (isRecord(maxDimensionsMm))
    issues.push(...positiveIntIssues(`${path}.maxDimensionsMm`, maxDimensionsMm, ['lengthMm', 'widthMm', 'heightMm']));
  else issues.push(`${path}.maxDimensionsMm must be an object`);
  if (isRecord(volumetricDivisor))
    issues.push(...positiveIntIssues(`${path}.volumetricDivisor`, volumetricDivisor, ['metric', 'imperial']));
  else issues.push(`${path}.volumetricDivisor must be an object`);
  if (!isRecord(bookingCutoff)) issues.push(`${path}.bookingCutoff must be an object`);
  else {
    if (minutesOfDay(bookingCutoff.localTime) === undefined) issues.push(`${path}.bookingCutoff.localTime must be HH:MM`);
    if (!isIanaTimeZone(bookingCutoff.timeZone)) issues.push(`${path}.bookingCutoff.timeZone must be an IANA zone`);
  }
  return issues;
}

function pickupIssues(pickup: unknown): string[] {
  if (!isRecord(pickup)) return ['pickup must be an object'];
  const issues: string[] = [];
  const { daysServed, minWindowMinutes } = pickup;
  if (!Array.isArray(daysServed) || daysServed.length === 0)
    issues.push('pickup.daysServed must be a non-empty array of ISO weekdays 1..7');
  else {
    if (daysServed.some((day) => !Number.isInteger(day) || (day as number) < 1 || (day as number) > 7)) {
      issues.push('pickup.daysServed must hold ISO weekdays 1..7');
    }
    if (new Set(daysServed).size !== daysServed.length) issues.push('pickup.daysServed has duplicates');
  }
  const earliest = minutesOfDay(pickup.earliestReady);
  const latest = minutesOfDay(pickup.latestClose);
  if (earliest === undefined) issues.push('pickup.earliestReady must be HH:MM');
  if (latest === undefined) issues.push('pickup.latestClose must be HH:MM');
  if (!isPositiveInt(minWindowMinutes)) issues.push('pickup.minWindowMinutes must be a positive integer');
  if (earliest !== undefined && latest !== undefined) {
    if (earliest >= latest) issues.push('pickup.earliestReady must be before pickup.latestClose');
    else if (isPositiveInt(minWindowMinutes) && minWindowMinutes > latest - earliest) {
      issues.push('pickup.minWindowMinutes must fit between earliestReady and latestClose');
    }
  }
  return issues;
}

/** Every defect of a capability declaration for `carrierCode`; empty when it is complete and well-formed. */
export function capabilityIssues(capabilities: unknown, carrierCode: string): string[] {
  if (!isRecord(capabilities)) return ['capabilities() must return an object'];
  const issues = operationsIssues(capabilities.operations);
  const { services, maxTrackingNumbersPerCall } = capabilities;
  if (!Array.isArray(services) || services.length === 0) issues.push('services must be a non-empty array');
  else {
    services.forEach((service, index) => issues.push(...serviceIssues(service, `services[${String(index)}]`, carrierCode)));
    const codes = services.map((service) => (isRecord(service) ? service.canonicalCode : undefined));
    if (new Set(codes).size !== codes.length) issues.push('services has duplicate canonical codes');
  }
  if (!isPositiveInt(maxTrackingNumbersPerCall) || maxTrackingNumbersPerCall > MAX_TRACKING_NUMBERS_PER_CALL_LIMIT) {
    issues.push(`maxTrackingNumbersPerCall must be an integer 1..${String(MAX_TRACKING_NUMBERS_PER_CALL_LIMIT)}`);
  }
  issues.push(...booleanIssues('capabilities', capabilities, ['pushTracking', 'idempotentCreate']), ...pickupIssues(capabilities.pickup));
  return issues;
}
