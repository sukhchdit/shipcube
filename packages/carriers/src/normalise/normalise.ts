/**
 * Normalisation at the adapter boundary (REQ-CARR-007, US-124, ADR-0010 §Interface). Pure functions over a carrier's
 * mapping tables (mappings.ts); the only side effect is one structured warning per dropped item through the injected
 * logger port. The policies:
 *  - service: mapped -> canonical code and tier; unmapped -> dropped from customer results and logged once with the
 *    carrier, the account and the service code (AT-US-124-02);
 *  - surcharge: mapped -> canonical code; unmapped -> `CARRIER_OTHER` with the carrier's label kept in `raw`
 *    (AT-US-124-03);
 *  - error: mapped -> canonical code; unmapped -> `CARRIER_UNKNOWN_ERROR`; the result is a `CarrierError` whose message
 *    comes from the canonical code, never from the raw carrier text (AT-US-124-04);
 *  - tracking event: mapped -> canonical status; unmapped -> dropped and logged, never guessed (the taxonomy and its
 *    state mapping are DR-B18 / TASK-168).
 * Log lines carry codes only (carrier, account, the carrier's code when it has a safe shape), never labels, messages
 * or bodies, which may echo personal data.
 */
import type { PlatformLogger } from '@platform/shared/logging';

import type { CarrierErrorCode, TrackingStatus } from '../canonical/codes.js';
import type { CarrierMoney, SurchargeLine } from '../canonical/types.js';
import type { CarrierAccountRef } from '../context.js';
import { CarrierError } from '../errors.js';
import type { CarrierOperation } from '../operations.js';
import { type CarrierMappings, lookupKey, type MappedService } from './mappings.js';

/** The logger port of the normalisers (the platform logger satisfies it). */
export type NormaliseLogger = Pick<PlatformLogger, 'warn'>;

/** Who the normalised answer belongs to: the account of the call (from `CarrierContext.account`). */
export interface NormaliseScope {
  readonly account: Pick<CarrierAccountRef, 'id' | 'code'>;
  readonly logger: NormaliseLogger;
}

export const UNMAPPED_SERVICE_EVENT = 'carrier.service.unmapped';
export const UNMAPPED_TRACKING_EVENT = 'carrier.tracking_event.unmapped';

/** A carrier code is logged only in this shape; anything else is logged as `UNPRINTABLE_CODE`. */
const LOGGABLE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/u;
export const UNPRINTABLE_CODE = '(unprintable)';
/** Bound of the raw label kept on a `CARRIER_OTHER` line. */
export const MAX_RAW_LABEL_LENGTH = 120;

const loggableCode = (value: unknown): string => (typeof value === 'string' && LOGGABLE_CODE.test(value) ? value : UNPRINTABLE_CODE);

/** Control characters and line breaks never survive into a stored label. */
const sanitiseLabel = (label: string): string =>
  label
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
    .trim()
    .slice(0, MAX_RAW_LABEL_LENGTH);

/** The canonical service of a carrier service code, or undefined when unmapped. */
export function mapService(mappings: CarrierMappings, carrierServiceCode: unknown): MappedService | undefined {
  const key = lookupKey(carrierServiceCode);
  return key === undefined ? undefined : mappings.services.get(key);
}

/**
 * Keeps the entries whose service code is mapped, each with its canonical service; drops the others and logs each
 * distinct unmapped code once per call.
 */
export function normaliseServices<T>(
  mappings: CarrierMappings,
  entries: readonly T[],
  serviceCodeOf: (entry: T) => unknown,
  scope: NormaliseScope,
): { readonly entry: T; readonly service: MappedService }[] {
  const kept: { readonly entry: T; readonly service: MappedService }[] = [];
  const logged = new Set<string>();
  for (const entry of entries) {
    const code = serviceCodeOf(entry);
    const service = mapService(mappings, code);
    if (service !== undefined) {
      kept.push({ entry, service });
      continue;
    }
    const printable = loggableCode(code);
    if (logged.has(printable)) continue;
    logged.add(printable);
    scope.logger.warn(UNMAPPED_SERVICE_EVENT, {
      carrier: mappings.carrierCode,
      account: scope.account.id,
      accountCode: scope.account.code,
      serviceCode: printable,
    });
  }
  return kept;
}

export interface CarrierSurcharge {
  /** The carrier's surcharge code, when it has one. */
  readonly code?: string;
  /** The carrier's label (`Remote Area Delivery`). */
  readonly label: string;
  readonly amount: CarrierMoney;
}

/** A canonical surcharge line; an unmapped surcharge is `CARRIER_OTHER` with its label in `raw`. */
export function normaliseSurcharge(mappings: CarrierMappings, surcharge: CarrierSurcharge): SurchargeLine {
  const byCode = lookupKey(surcharge.code);
  const byLabel = lookupKey(surcharge.label);
  const code =
    (byCode === undefined ? undefined : mappings.surcharges.get(byCode)) ??
    (byLabel === undefined ? undefined : mappings.surcharges.get(byLabel));
  if (code !== undefined) return Object.freeze({ code, amount: surcharge.amount });
  return Object.freeze({ code: 'CARRIER_OTHER', amount: surcharge.amount, raw: sanitiseLabel(surcharge.label) });
}

export interface CarrierFailure {
  /** The carrier's error code (`1001`, `INVALID.POSTAL.CODE`). */
  readonly code?: string;
  /** The carrier's message; used for matching only, never kept. */
  readonly message?: string;
  readonly operation?: CarrierOperation;
  readonly cause?: unknown;
}

/** The canonical code of a carrier error: by code, then by message; `CARRIER_UNKNOWN_ERROR` when neither is mapped. */
export function mapErrorCode(mappings: CarrierMappings, failure: Pick<CarrierFailure, 'code' | 'message'>): CarrierErrorCode {
  const byCode = lookupKey(failure.code);
  const byMessage = lookupKey(failure.message);
  return (
    (byCode === undefined ? undefined : mappings.errors.get(byCode)) ??
    (byMessage === undefined ? undefined : mappings.errors.get(byMessage)) ??
    'CARRIER_UNKNOWN_ERROR'
  );
}

/** The `CarrierError` of a carrier failure; its message is the canonical text, the raw carrier message is dropped. */
export function normaliseError(mappings: CarrierMappings, failure: CarrierFailure): CarrierError {
  return new CarrierError(mapErrorCode(mappings, failure), {
    carrier: mappings.carrierCode,
    ...(failure.operation === undefined ? {} : { operation: failure.operation }),
    ...(failure.code === undefined ? {} : { carrierErrorCode: failure.code }),
    ...(failure.cause === undefined ? {} : { cause: failure.cause }),
  });
}

/** The canonical status of a carrier tracking event code, or undefined when unmapped. */
export function mapTrackingStatus(mappings: CarrierMappings, carrierEventCode: unknown): TrackingStatus | undefined {
  const key = lookupKey(carrierEventCode);
  return key === undefined ? undefined : mappings.trackingEvents.get(key);
}

/** Keeps the events whose code is mapped, each with its canonical status; drops and logs the others (once per code). */
export function normaliseTrackingEvents<T>(
  mappings: CarrierMappings,
  events: readonly T[],
  eventCodeOf: (event: T) => unknown,
  scope: NormaliseScope,
): { readonly event: T; readonly status: TrackingStatus }[] {
  const kept: { readonly event: T; readonly status: TrackingStatus }[] = [];
  const logged = new Set<string>();
  for (const event of events) {
    const code = eventCodeOf(event);
    const status = mapTrackingStatus(mappings, code);
    if (status !== undefined) {
      kept.push({ event, status });
      continue;
    }
    const printable = loggableCode(code);
    if (logged.has(printable)) continue;
    logged.add(printable);
    scope.logger.warn(UNMAPPED_TRACKING_EVENT, {
      carrier: mappings.carrierCode,
      account: scope.account.id,
      accountCode: scope.account.code,
      eventCode: printable,
    });
  }
  return kept;
}
