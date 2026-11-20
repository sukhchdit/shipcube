/**
 * The deterministic Mock carrier (REQ-CARR-004, US-122, ADR-0010 §Mock carrier, D-062). A `CarrierAdapter` that needs no
 * carrier, no credentials and no network: every answer is a pure function of the request (and, for the latency hook, of
 * the scenario directive), so the same input always gives the same output. Time and waiting enter only through the
 * injected seams `monotonicMs` (call duration for the log line) and `sleep` (the latency directive).
 *
 * Every operation is wrapped once (`instrument`): it applies the latency directive when scenarios are enabled, then
 * emits exactly one `carrier.call` line through `outboundCallFields` (identifiers, route template, duration and error
 * code only; never a body, an address or a party) and keeps a bounded call record carrying the same correlation ID, so
 * the booking saga's `carrier_call` audit entry can cite it (AT-US-008-03, Mock hop).
 *
 * Registration goes through `createCarrierRegistry`, decided by the composition root from `MOCK_CARRIER_ENABLED`; the
 * flag `MOCK_SCENARIOS_ENABLED` arrives as `scenariosEnabled` (default false: directives are ignored).
 */
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

import { outboundCallFields } from '@platform/shared/logging';
import type { PlatformLogger } from '@platform/shared/logging';

import type { CarrierAdapter } from '../../adapter.js';
import type { CarrierCapabilities } from '../../capabilities.js';
import { minutesOfDay } from '../../capabilities.js';
import { type CarrierErrorCode, type DocumentFormat, canonicalServiceCode, isDocumentFormat } from '../../canonical/codes.js';
import type {
  Address,
  AddressValidation,
  CancelResult,
  CarrierShipmentRef,
  LabelDocument,
  PackageSpec,
  PaperlessRequest,
  PickupConfirmation,
  PickupRef,
  PickupRequest,
  RateQuote,
  RateRequest,
  RateResponse,
  ServicePoint,
  ServicePointQuery,
  ShipmentConfirmation,
  ShipmentPackageResult,
  ShipmentRequest,
  TrackingResult,
} from '../../canonical/types.js';
import type { CarrierContext } from '../../context.js';
import { CarrierContractError, CarrierError } from '../../errors.js';
import type { CarrierOperation } from '../../operations.js';
import { mockCapabilities, MOCK_CANONICAL_SERVICES } from './capabilities.js';
import {
  DEFAULT_MAX_CALL_RECORDS,
  MAX_TRACKING_NUMBERS,
  MOCK_CARRIER_CODE,
  MOCK_CURRENCY,
  MOCK_SERVICE_CODES,
  MOCK_SERVICES,
  type MockZone,
  PICKUP_DAYS,
  PICKUP_EARLIEST_READY,
  PICKUP_LATEST_CLOSE,
  PICKUP_MIN_WINDOW_MINUTES,
} from './constants.js';
import { isMockPickupConfirmation, isMockTrackingNumber, pickupConfirmationFor, servicePointIdFor, trackingNumberFor } from './derive.js';
import { mockLabel } from './labels.js';
import { assertPackages, billableWeightG, estimatedDelivery, limitViolation, priceService } from './rates.js';
import { parseLatencyMs } from './scenario.js';
import { baselineEvents, DEFAULT_TRACKING_START } from './tracking.js';
import { laneZone } from './zones.js';

/** One entry of the Mock's call record: identifiers and outcome only, never request or response content. */
export interface MockCallRecord {
  readonly operation: CarrierOperation;
  /** `CarrierContext.correlationId` of the call. */
  readonly correlationId: string;
  readonly accountId: string;
  /** `OK`, or the canonical error code the call ended with. */
  readonly outcome: 'OK' | CarrierErrorCode;
  readonly durationMs: number;
}

export interface MockAdapterOptions {
  /** Receives one `carrier.call` line per operation. */
  readonly logger: Pick<PlatformLogger, 'info'>;
  /** `MOCK_SCENARIOS_ENABLED`; false (default) ignores every scenario directive. */
  readonly scenariosEnabled?: boolean;
  /** Waits `ms` for the latency directive (tests inject a recorder). Defaults to a timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Monotonic milliseconds for the log line's duration. Defaults to `performance.now`. */
  readonly monotonicMs?: () => number;
  /** ISO instant the baseline tracking events count from. */
  readonly trackingStart?: string;
  /** Bound of the call record list (oldest entries drop first). */
  readonly maxCallRecords?: number;
}

/** The Mock adapter: every optional operation but `estimateLandedCost` (declared unsupported), plus the call record. */
export type MockCarrierAdapter = Omit<Required<CarrierAdapter>, 'estimateLandedCost'> & {
  /** The calls made so far, oldest first, bounded by `maxCallRecords`. */
  callRecords(): readonly MockCallRecord[];
};

/** Route templates of the log line: the Mock has no URL, so these name the operation only. */
const ROUTE: Readonly<Record<CarrierOperation, string>> = {
  getRates: '/mock/v1/rates',
  createShipment: '/mock/v1/shipments',
  cancelShipment: '/mock/v1/shipments/{trackingNumber}/cancel',
  schedulePickup: '/mock/v1/pickups',
  cancelPickup: '/mock/v1/pickups/{confirmationNumber}/cancel',
  track: '/mock/v1/tracking',
  validateAddress: '/mock/v1/addresses/validate',
  findServicePoints: '/mock/v1/service-points',
  uploadCustomsDocuments: '/mock/v1/shipments/{trackingNumber}/documents',
  estimateLandedCost: '/mock/v1/landed-cost',
  recoverLabel: '/mock/v1/shipments/{trackingNumber}/labels',
};

const COUNTRY = /^[A-Z]{2}$/u;
const POSTAL_CODE = /^[A-Za-z0-9][A-Za-z0-9 -]{1,14}$/u;
const DEFAULT_LABEL_FORMAT: DocumentFormat = 'PDF_4X6';
const MAX_SERVICE_POINTS = 10;
const DEFAULT_SERVICE_POINTS = 3;

/** Upper-case country of an address; a code that is not two letters is an `INVALID_ADDRESS` answer. */
function countryOf(address: Address): string {
  const country = typeof address.countryCode === 'string' ? address.countryCode.toUpperCase() : '';
  if (!COUNTRY.test(country)) throw new CarrierError('INVALID_ADDRESS', { carrier: MOCK_CARRIER_CODE });
  return country;
}

const quoteOf = (service: (typeof MOCK_SERVICE_CODES)[number], zone: MockZone, billableG: number, shipDate: string): RateQuote => {
  const spec = MOCK_SERVICES[service];
  const price = priceService(service, zone, billableG);
  const delivery = estimatedDelivery(shipDate, spec.transitDaysMax);
  return {
    serviceCode: canonicalServiceCode(MOCK_CARRIER_CODE, service),
    tier: spec.tier,
    baseCharge: { amountMinor: price.base.amount, currency: MOCK_CURRENCY },
    surcharges: [{ code: 'FUEL', amount: { amountMinor: price.fuel.amount, currency: MOCK_CURRENCY } }],
    totalCharge: { amountMinor: price.total.amount, currency: MOCK_CURRENCY },
    transitDaysMin: spec.transitDaysMin,
    transitDaysMax: spec.transitDaysMax,
    ...(delivery === undefined ? {} : { estimatedDelivery: delivery }),
  };
};

/** The Mock's rate answer: the three services, or an empty answer with the limit that was broken. */
function rate(req: RateRequest): RateResponse {
  assertPackages(req.packages);
  if (req.packages.length === 0) return { quotes: [], noServiceReason: 'SERVICE_UNAVAILABLE' };
  const zone = laneZone(countryOf(req.origin), countryOf(req.destination));
  const violation = limitViolation(req.packages);
  if (violation !== undefined) return { quotes: [], noServiceReason: violation };
  const billableG = billableWeightG(req.packages);
  return { quotes: MOCK_SERVICE_CODES.map((service) => quoteOf(service, zone, billableG, req.shipDate)) };
}

/** Requested label formats the Mock can produce, without duplicates; PDF_4X6 when none was asked for. */
function labelFormatsOf(requested: readonly DocumentFormat[]): DocumentFormat[] {
  const formats = [...new Set(Array.isArray(requested) ? requested.filter(isDocumentFormat) : [])];
  return formats.length > 0 ? formats : [DEFAULT_LABEL_FORMAT];
}

function packageResults(clientReference: string, packages: readonly PackageSpec[]): ShipmentPackageResult[] {
  return packages.map((_spec, index) => {
    const trackingNumber = trackingNumberFor(clientReference, index + 1);
    return { seq: index + 1, trackingNumber, carrierPackageRef: `${trackingNumber}-${String(index + 1)}` };
  });
}

function shipmentOf(req: ShipmentRequest): ShipmentConfirmation {
  if (typeof req.clientReference !== 'string' || req.clientReference.length === 0) {
    throw new CarrierContractError('invalid ShipmentRequest', ['clientReference must be a non-empty string']);
  }
  const service = MOCK_CANONICAL_SERVICES.get(req.serviceCode);
  if (service === undefined) throw new CarrierError('SERVICE_UNAVAILABLE', { carrier: MOCK_CARRIER_CODE });
  assertPackages(req.packages);
  const zone = laneZone(countryOf(req.shipper.address), countryOf(req.recipient.address));
  const violation = limitViolation(req.packages);
  if (req.packages.length === 0 || violation !== undefined) {
    throw new CarrierError(violation ?? 'SERVICE_UNAVAILABLE', { carrier: MOCK_CARRIER_CODE });
  }
  const trackingNumber = trackingNumberFor(req.clientReference);
  const price = priceService(service, zone, billableWeightG(req.packages));
  return {
    ref: { trackingNumber, clientReference: req.clientReference },
    serviceCode: req.serviceCode,
    labels: labelFormatsOf(req.labelFormats).map((format) => mockLabel(format, trackingNumber)),
    packages: packageResults(req.clientReference, req.packages),
    charge: { amountMinor: price.total.amount, currency: MOCK_CURRENCY },
  };
}

/** ISO weekday (1 Monday .. 7 Sunday) of an ISO date, or undefined for a malformed one. */
function isoWeekday(date: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return undefined;
  const time = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isNaN(time) ? undefined : ((new Date(time).getUTCDay() + 6) % 7) + 1;
}

/** Whether the Mock serves the pickup: a served weekday and a window inside the hours, at least the minimum long. */
function pickupServed(req: PickupRequest): boolean {
  const weekday = isoWeekday(req.date);
  const ready = minutesOfDay(req.readyTime);
  const close = minutesOfDay(req.closeTime);
  if (weekday === undefined || ready === undefined || close === undefined || !PICKUP_DAYS.includes(weekday)) return false;
  return (
    req.shipments.length > 0 &&
    ready >= (minutesOfDay(PICKUP_EARLIEST_READY) ?? 0) &&
    close <= (minutesOfDay(PICKUP_LATEST_CLOSE) ?? 0) &&
    close - ready >= PICKUP_MIN_WINDOW_MINUTES
  );
}

function validateMockAddress(address: Address): AddressValidation {
  const country = typeof address.countryCode === 'string' ? address.countryCode.toUpperCase() : '';
  if (!COUNTRY.test(country)) return { valid: false, suggestions: [], reason: 'INVALID_ADDRESS' };
  if (address.postalCode === undefined || !POSTAL_CODE.test(address.postalCode)) {
    return { valid: false, suggestions: [], reason: 'POSTCODE_INVALID' };
  }
  return { valid: true, suggestions: [] };
}

function servicePointsFor(query: ServicePointQuery): ServicePoint[] {
  const country = countryOf(query.address);
  const postalCode = query.address.postalCode ?? '';
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_SERVICE_POINTS), 0), MAX_SERVICE_POINTS);
  const points: ServicePoint[] = [];
  for (let position = 1; position <= MAX_SERVICE_POINTS && points.length < limit; position += 1) {
    const distanceM = position * position * 300 + 100;
    if (query.radiusM !== undefined && distanceM > query.radiusM) break;
    points.push({
      id: servicePointIdFor(country, postalCode, position),
      name: `Mock Service Point ${String(position)}`,
      address: { countryCode: country, ...(query.address.postalCode === undefined ? {} : { postalCode: query.address.postalCode }) },
      distanceM,
    });
  }
  return points;
}

/** Builds the Mock carrier adapter; every call it serves is logged once and recorded once. */
export function createMockAdapter(options: MockAdapterOptions): MockCarrierAdapter {
  const { logger } = options;
  const scenariosEnabled = options.scenariosEnabled === true;
  const sleep = options.sleep ?? ((ms: number): Promise<void> => delay(ms));
  const monotonicMs = options.monotonicMs ?? ((): number => performance.now());
  const trackingStart = options.trackingStart ?? DEFAULT_TRACKING_START;
  const maxRecords = Math.max(1, options.maxCallRecords ?? DEFAULT_MAX_CALL_RECORDS);
  const records: MockCallRecord[] = [];
  const capabilities = mockCapabilities();

  /** The single wrapper of every operation: latency hook, the answer, then one log line and one record. */
  const instrument = async <R>(operation: CarrierOperation, ctx: CarrierContext, answer: () => R): Promise<R> => {
    const started = monotonicMs();
    let outcome: MockCallRecord['outcome'] = 'OK';
    try {
      const latencyMs = scenariosEnabled ? parseLatencyMs(ctx.mockScenario) : 0;
      if (latencyMs > 0) await sleep(latencyMs);
      return answer();
    } catch (error) {
      outcome = error instanceof CarrierError ? error.code : 'CARRIER_UNKNOWN_ERROR';
      throw error;
    } finally {
      const durationMs = Math.max(0, Math.round(monotonicMs() - started));
      logger.info(
        'carrier.call',
        outboundCallFields({
          carrierCode: MOCK_CARRIER_CODE,
          accountId: ctx.account.id,
          operation,
          routeTemplate: ROUTE[operation],
          durationMs,
          ...(outcome === 'OK' ? {} : { errorCode: outcome }),
          correlationId: ctx.correlationId,
        }),
      );
      records.push({ operation, correlationId: ctx.correlationId, accountId: ctx.account.id, outcome, durationMs });
      if (records.length > maxRecords) records.splice(0, records.length - maxRecords);
    }
  };

  return {
    code: MOCK_CARRIER_CODE,
    capabilities: (): CarrierCapabilities => capabilities,
    callRecords: () => [...records],

    getRates: (req, ctx) => instrument('getRates', ctx, () => rate(req)),
    createShipment: (req, ctx) => instrument('createShipment', ctx, () => shipmentOf(req)),
    cancelShipment: (ref: CarrierShipmentRef, ctx) =>
      instrument('cancelShipment', ctx, (): CancelResult =>
        isMockTrackingNumber(ref.trackingNumber) ? { cancelled: true } : { cancelled: false, reason: 'CANNOT_VOID' },
      ),
    schedulePickup: (req, ctx) =>
      instrument('schedulePickup', ctx, (): PickupConfirmation => {
        if (!pickupServed(req)) throw new CarrierError('PICKUP_UNAVAILABLE', { carrier: MOCK_CARRIER_CODE });
        const numbers = req.shipments.map(({ trackingNumber }) => trackingNumber).sort();
        return {
          ref: { confirmationNumber: pickupConfirmationFor([req.date, req.readyTime, req.closeTime, ...numbers]), date: req.date },
          readyTime: req.readyTime,
          closeTime: req.closeTime,
        };
      }),
    cancelPickup: (ref: PickupRef, ctx) =>
      instrument('cancelPickup', ctx, (): CancelResult =>
        isMockPickupConfirmation(ref.confirmationNumber) ? { cancelled: true } : { cancelled: false, reason: 'PICKUP_UNAVAILABLE' },
      ),
    track: (numbers, ctx) =>
      instrument('track', ctx, (): TrackingResult[] => {
        if (numbers.length > MAX_TRACKING_NUMBERS) {
          throw new CarrierContractError('invalid track request', [`at most ${String(MAX_TRACKING_NUMBERS)} tracking numbers per call`]);
        }
        return numbers.map((trackingNumber) =>
          isMockTrackingNumber(trackingNumber)
            ? { trackingNumber, found: true, events: baselineEvents(trackingNumber, trackingStart) }
            : { trackingNumber, found: false, events: [] },
        );
      }),

    validateAddress: (address, ctx) => instrument('validateAddress', ctx, () => validateMockAddress(address)),
    findServicePoints: (query, ctx) => instrument('findServicePoints', ctx, () => servicePointsFor(query)),
    uploadCustomsDocuments: (req: PaperlessRequest, ctx) =>
      instrument('uploadCustomsDocuments', ctx, (): void => {
        if (req.documents.length === 0 || req.documents.some(({ content }) => content.length === 0)) {
          throw new CarrierError('CUSTOMS_DATA_INVALID', { carrier: MOCK_CARRIER_CODE });
        }
      }),
    recoverLabel: (ref, formats, ctx) =>
      instrument('recoverLabel', ctx, (): LabelDocument[] => {
        if (!isMockTrackingNumber(ref.trackingNumber)) throw new CarrierError('SERVICE_UNAVAILABLE', { carrier: MOCK_CARRIER_CODE });
        return [...new Set(formats.filter(isDocumentFormat))].map((format) => mockLabel(format, ref.trackingNumber));
      }),
  };
}
