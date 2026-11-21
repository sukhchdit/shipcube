/**
 * The Mock capability declaration (REQ-CARR-002, AT-US-122-05, AT-US-121-02 on the real Mock). Pure data, the same value
 * on every call.
 */
import type { CarrierCapabilities, ServiceCapability } from '../../capabilities.js';
import { canonicalServiceCode } from '../../canonical/codes.js';
import {
  MAX_DIMENSIONS_MM,
  MAX_PACKAGE_WEIGHT_G,
  MAX_SHIPMENT_WEIGHT_G,
  MAX_TRACKING_NUMBERS,
  MOCK_CARRIER_CODE,
  MOCK_SERVICE_CODES,
  MOCK_SERVICES,
  PICKUP_DAYS,
  PICKUP_EARLIEST_READY,
  PICKUP_LATEST_CLOSE,
  PICKUP_MIN_WINDOW_MINUTES,
} from './constants.js';

/** Service codes the Mock accepts, by canonical code (`MOCK_EXPRESS` -> `EXPRESS`). */
export const MOCK_CANONICAL_SERVICES: ReadonlyMap<string, (typeof MOCK_SERVICE_CODES)[number]> = new Map(
  MOCK_SERVICE_CODES.map((code) => [canonicalServiceCode(MOCK_CARRIER_CODE, code), code]),
);

const service = (code: (typeof MOCK_SERVICE_CODES)[number]): ServiceCapability => ({
  canonicalCode: canonicalServiceCode(MOCK_CARRIER_CODE, code),
  carrierServiceCode: code,
  tier: MOCK_SERVICES[code].tier,
  directions: ['EXPORT', 'IMPORT', 'DOMESTIC'],
  contentTypes: ['DOCUMENT', 'PARCEL'],
  maxPackageWeightG: MAX_PACKAGE_WEIGHT_G,
  maxShipmentWeightG: MAX_SHIPMENT_WEIGHT_G,
  maxDimensionsMm: { ...MAX_DIMENSIONS_MM },
  volumetricDivisor: { metric: 5000, imperial: 139 },
  bookingCutoff: { localTime: '17:00', timeZone: 'UTC' },
  dropoff: true,
  pickup: true,
  ddp: true,
  paperless: true,
  labelFormats: ['PDF_4X6', 'PDF_A4', 'PDF_LETTER', 'ZPL'],
});

/** A fresh declaration per call (callers may freeze or clone it; the value never changes). */
export function mockCapabilities(): CarrierCapabilities {
  return {
    operations: {
      validateAddress: true,
      findServicePoints: true,
      uploadCustomsDocuments: true,
      estimateLandedCost: false,
      recoverLabel: true,
      cancelShipment: true,
    },
    services: MOCK_SERVICE_CODES.map(service),
    maxTrackingNumbersPerCall: MAX_TRACKING_NUMBERS,
    pushTracking: false,
    idempotentCreate: true,
    pickup: {
      daysServed: [...PICKUP_DAYS],
      earliestReady: PICKUP_EARLIEST_READY,
      latestClose: PICKUP_LATEST_CLOSE,
      minWindowMinutes: PICKUP_MIN_WINDOW_MINUTES,
    },
  };
}
