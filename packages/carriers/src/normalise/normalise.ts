/**
 * Normalisation at the adapter boundary (REQ-CARR-007, US-124, ADR-0010 §Interface). Pure functions over a carrier's
 * mapping tables (mappings.ts); the only side effect is structured warnings through the injected logger port. The
 * policies:
 *  - service: mapped -> canonical code and tier; unmapped -> dropped from customer results and logged with the carrier,
 *    the account and the service code (AT-US-124-02);
 *  - surcharge: mapped -> canonical code; unmapped -> `CARRIER_OTHER` with the carrier's label kept in `raw`
 *    (AT-US-124-03);
 *  - error: mapped -> canonical code; unmapped -> `CARRIER_UNKNOWN_ERROR`; the result is a `CarrierError` whose message
 *    comes from the canonical code and whose cause is reduced to `{ name, code? }`, never raw carrier text
 *    (AT-US-124-04, ADR-0010 am. 11 item 8);
 *  - tracking event: mapped -> canonical status; unmapped -> `IN_TRANSIT` with `unmapped: true`, never dropped
 *    (REQ-TRACK-001, US-241; TASK-168 increments `tracking_unmapped_event_total` from the flag).
 * Warn lines carry codes only (carrier, account, the carrier's code when it has a safe shape), never labels,
 * descriptions, messages or bodies, which may echo personal data. At most `MAX_UNMAPPED_WARNINGS` distinct codes are
 * logged per call, then one summary line with the count (PR075-SEC-07).
 */
import type { PlatformLogger } from '@platform/shared/logging';

import type { CarrierErrorCode, TrackingStatus } from '../canonical/codes.js';
import type { CarrierMoney, SurchargeLine } from '../canonical/types.js';
import type { CarrierAccountRef } from '../context.js';
import { CarrierError } from '../errors.js';
import type { CarrierOperation } from '../operations.js';
import { type CarrierMappings, lookupKey, type MappedService } from './mappings.js';

/** The logger port of the normalisers and the guard (the platform logger satisfies it). */
export type NormaliseLogger = Pick<PlatformLogger, 'warn'>;

/** Who the normalised answer belongs to: the account of the call (from `CarrierContext.account`). */
export interface NormaliseScope {
  readonly account: Pick<CarrierAccountRef, 'id' | 'code'>;
  readonly logger: NormaliseLogger;
}

export const UNMAPPED_SERVICE_EVENT = 'carrier.service.unmapped';
export const UNMAPPED_TRACKING_EVENT = 'carrier.tracking_event.unmapped';
/** Distinct unmapped codes logged per call before the rest is summarised in one line. */
export const MAX_UNMAPPED_WARNINGS = 20;

/** A carrier code is logged only in this shape; anything else is logged as `UNPRINTABLE_CODE`. */
const LOGGABLE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/u;
export const UNPRINTABLE_CODE = '(unprintable)';
/** Bound of the raw label kept on a `CARRIER_OTHER` line. */
export const MAX_RAW_LABEL_LENGTH = 120;

const loggableCode = (value: unknown): string => (typeof value === 'string' && LOGGABLE_CODE.test(value) ? value : UNPRINTABLE_CODE);

/** Control, format (bidi, zero-width) and separator characters, and lone surrogates, never survive into a stored label. */
const UNSAFE_LABEL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]+/gu;
const LONE_SURROGATE = /\p{Cs}/gu;
const sanitiseLabel = (label: string): string =>
  label.replace(UNSAFE_LABEL_CHARS, ' ').trim().slice(0, MAX_RAW_LABEL_LENGTH).replace(LONE_SURROGATE, '');

/**
 * Logs each distinct unmapped code once, up to `MAX_UNMAPPED_WARNINGS`, then reports the remainder in one summary
 * line when `flush` is called.
 */
function unmappedReporter(event: string, codeField: string, mappings: CarrierMappings, scope: NormaliseScope) {
  const seen = new Set<string>();
  const base = { carrier: mappings.carrierCode, account: scope.account.id, accountCode: scope.account.code };
  return {
    report(code: unknown): void {
      const printable = loggableCode(code);
      if (seen.has(printable)) return;
      seen.add(printable);
      if (seen.size <= MAX_UNMAPPED_WARNINGS) scope.logger.warn(event, { ...base, [codeField]: printable });
    },
    flush(): void {
      if (seen.size > MAX_UNMAPPED_WARNINGS) scope.logger.warn(event, { ...base, unmappedCount: seen.size, logged: MAX_UNMAPPED_WARNINGS });
    },
  };
}

/** The canonical service of a carrier service code, or undefined when unmapped. */
export function mapService(mappings: CarrierMappings, carrierServiceCode: unknown): MappedService | undefined {
  const key = lookupKey(carrierServiceCode);
  return key === undefined ? undefined : mappings.services.get(key);
}

/** Keeps the entries whose service code is mapped, each with its canonical service; drops and logs the others. */
export function normaliseServices<T>(
  mappings: CarrierMappings,
  entries: readonly T[],
  serviceCodeOf: (entry: T) => unknown,
  scope: NormaliseScope,
): { readonly entry: T; readonly service: MappedService }[] {
  const kept: { readonly entry: T; readonly service: MappedService }[] = [];
  const reporter = unmappedReporter(UNMAPPED_SERVICE_EVENT, 'serviceCode', mappings, scope);
  for (const entry of entries) {
    const code = serviceCodeOf(entry);
    const service = mapService(mappings, code);
    if (service === undefined) reporter.report(code);
    else kept.push({ entry, service });
  }
  reporter.flush();
  return kept;
}

export interface CarrierSurcharge {
  /** The carrier's surcharge code, when it has one. */
  readonly code?: string;
  /** The carrier's label (`Remote Area Delivery`). */
  readonly label: string;
  readonly amount: CarrierMoney;
}

/** A canonical surcharge line; an unmapped surcharge is `CARRIER_OTHER` with its sanitised label in `raw`. */
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
  /** Underlying failure; only its class name and a safe code are kept (`safeCause`). */
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

/** The `CarrierError` of a carrier failure; the message is the canonical text, the raw message and cause text are dropped. */
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

/** Status of an event whose carrier code has no mapping (REQ-TRACK-001). */
export const UNMAPPED_TRACKING_STATUS: TrackingStatus = 'IN_TRANSIT';

/**
 * One canonical status per input event, in order, never dropping one: a mapped code gives its status with
 * `unmapped: false`; an unmapped code gives `IN_TRANSIT` with `unmapped: true` and a warn line (codes only, never the
 * event's description).
 */
export function normaliseTrackingEvents<T>(
  mappings: CarrierMappings,
  events: readonly T[],
  eventCodeOf: (event: T) => unknown,
  scope: NormaliseScope,
): { readonly event: T; readonly status: TrackingStatus; readonly unmapped: boolean }[] {
  const reporter = unmappedReporter(UNMAPPED_TRACKING_EVENT, 'eventCode', mappings, scope);
  const result = events.map((event) => {
    const code = eventCodeOf(event);
    const status = mapTrackingStatus(mappings, code);
    if (status !== undefined) return { event, status, unmapped: false };
    reporter.report(code);
    return { event, status: UNMAPPED_TRACKING_STATUS, unmapped: true };
  });
  reporter.flush();
  return result;
}
