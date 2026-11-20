/**
 * Per-carrier mapping tables to the Platform canonical codes (REQ-CARR-007, DR-B30, DR-B18; ADR-0010 §Interface). An
 * adapter declares its tables once with `defineCarrierMappings`, which fails start-up, naming each defect, when a
 * mapped value is not in the canonical catalogue (AT-US-124-05) or two carrier keys collide after normalisation. Keys
 * are matched after `mappingKey` (trimmed, inner whitespace collapsed, upper-cased), so `Remote Area Delivery` and
 * `REMOTE  AREA delivery` are one key. Lookups go through `Map`s, so a carrier string such as `__proto__` or
 * `constructor` can never resolve to an inherited property.
 */
import {
  CARRIER_ERROR_CODES,
  CARRIER_SERVICE_CODE_PATTERN,
  type CarrierErrorCode,
  canonicalServiceCode,
  isCarrierCode,
  isCarrierErrorCode,
  isServiceTier,
  isSurchargeCode,
  isTrackingStatus,
  SERVICE_TIERS,
  type ServiceTier,
  SURCHARGE_CODES,
  type SurchargeCode,
  TRACKING_STATUSES,
  type TrackingStatus,
} from '../canonical/codes.js';
import { CarrierContractError } from '../errors.js';

export interface CarrierMappingsInput {
  readonly carrierCode: string;
  /** Carrier service code -> tier. The canonical code is derived (carrier code plus service code, DR-B30). */
  readonly services: Readonly<Record<string, ServiceTier>>;
  /** Carrier surcharge code or label -> canonical surcharge code. */
  readonly surcharges: Readonly<Record<string, SurchargeCode>>;
  /** Carrier error code or message -> canonical error code. */
  readonly errors: Readonly<Record<string, CarrierErrorCode>>;
  /** Carrier tracking event code -> canonical tracking status (DR-B18). */
  readonly trackingEvents: Readonly<Record<string, TrackingStatus>>;
}

export interface MappedService {
  readonly canonicalCode: string;
  readonly tier: ServiceTier;
}

export interface CarrierMappings {
  readonly carrierCode: string;
  readonly services: ReadonlyMap<string, MappedService>;
  readonly surcharges: ReadonlyMap<string, SurchargeCode>;
  readonly errors: ReadonlyMap<string, CarrierErrorCode>;
  readonly trackingEvents: ReadonlyMap<string, TrackingStatus>;
}

/** Upper bound of a carrier string used as a lookup key; longer text never matches a table key. */
export const MAX_MAPPING_KEY_LENGTH = 200;

/** The lookup form of a carrier code or label: trimmed, inner whitespace collapsed to one space, upper-cased. */
export function mappingKey(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toUpperCase();
}

/** The lookup key of an untrusted carrier string, or undefined when it cannot be a table key. */
export function lookupKey(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_MAPPING_KEY_LENGTH) return undefined;
  const key = mappingKey(value);
  return key === '' ? undefined : key;
}

type TableName = 'services' | 'surcharges' | 'errors' | 'trackingEvents';

const TABLE_RULES: Readonly<Record<TableName, { readonly isMember: (value: unknown) => boolean; readonly allowed: readonly string[] }>> = {
  services: { isMember: isServiceTier, allowed: SERVICE_TIERS },
  surcharges: { isMember: isSurchargeCode, allowed: SURCHARGE_CODES },
  errors: { isMember: isCarrierErrorCode, allowed: CARRIER_ERROR_CODES },
  trackingEvents: { isMember: isTrackingStatus, allowed: TRACKING_STATUSES },
};

/** Every defect of a mapping table set; empty when every key is usable and every value is in the DR-B30/DR-B18 catalogue. */
export function mappingIssues(input: CarrierMappingsInput): string[] {
  const issues: string[] = [];
  if (!isCarrierCode(input.carrierCode)) issues.push('carrierCode must match ^[A-Z][A-Z0-9_]{1,31}$');
  for (const table of Object.keys(TABLE_RULES) as TableName[]) {
    const entries = input[table] as Readonly<Record<string, unknown>> | undefined;
    if (typeof entries !== 'object' || entries === null) {
      issues.push(`${table} must be an object`);
      continue;
    }
    const { isMember, allowed } = TABLE_RULES[table];
    const seen = new Map<string, string>();
    for (const [key, value] of Object.entries(entries)) {
      const at = `${table}[${JSON.stringify(key)}]`;
      if (!isMember(value)) issues.push(`${at} maps to ${JSON.stringify(value)}, which is not one of ${allowed.join(' | ')}`);
      const normalised = lookupKey(key);
      if (normalised === undefined) issues.push(`${at} is not a usable key (empty or longer than ${String(MAX_MAPPING_KEY_LENGTH)})`);
      else if (seen.has(normalised)) issues.push(`${at} collides with ${JSON.stringify(seen.get(normalised))} after normalisation`);
      else seen.set(normalised, key);
      if (table === 'services' && !CARRIER_SERVICE_CODE_PATTERN.test(key)) {
        issues.push(`${at} is not a valid carrier service code (${CARRIER_SERVICE_CODE_PATTERN.source})`);
      }
    }
  }
  return issues;
}

/** Validates and freezes a carrier's tables; throws `CarrierContractError` naming every defect. */
export function defineCarrierMappings(input: CarrierMappingsInput): CarrierMappings {
  const issues = mappingIssues(input);
  if (issues.length > 0) throw new CarrierContractError(`invalid mapping tables for ${String(input.carrierCode)}`, issues);
  const toMap = <V, R>(record: Readonly<Record<string, V>>, convert: (key: string, value: V) => R): ReadonlyMap<string, R> =>
    new Map(Object.entries(record).map(([key, value]) => [mappingKey(key), convert(key, value)]));
  return Object.freeze({
    carrierCode: input.carrierCode,
    services: toMap(input.services, (key, tier) => Object.freeze({ canonicalCode: canonicalServiceCode(input.carrierCode, key), tier })),
    surcharges: toMap(input.surcharges, (_key, code) => code),
    errors: toMap(input.errors, (_key, code) => code),
    trackingEvents: toMap(input.trackingEvents, (_key, status) => status),
  });
}
