import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { capabilityIssues, isIanaTimeZone, minutesOfDay, type ServiceCapability } from './capabilities.js';
import { FAKE_CARRIER, fakeCapabilities, fakeService } from './tests/fake-adapter.js';

const issuesOf = (capabilities: unknown): string[] => capabilityIssues(capabilities, FAKE_CARRIER);
const withService = (service: Record<string, unknown>): unknown =>
  fakeCapabilities({ services: [service as unknown as ServiceCapability] });
const without = (record: object, key: string): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...record };
  delete copy[key];
  return copy;
};

/** REQ-CARR-002 per-service facts, by field. */
const SERVICE_FIELDS = [
  'canonicalCode',
  'carrierServiceCode',
  'tier',
  'directions',
  'contentTypes',
  'maxPackageWeightG',
  'maxShipmentWeightG',
  'maxDimensionsMm',
  'volumetricDivisor',
  'bookingCutoff',
  'dropoff',
  'pickup',
  'ddp',
  'paperless',
  'labelFormats',
] as const;
/** REQ-CARR-002 carrier-level facts. */
const CARRIER_FIELDS = ['operations', 'services', 'maxTrackingNumbersPerCall', 'pushTracking', 'idempotentCreate', 'pickup'] as const;
const PICKUP_FIELDS = ['daysServed', 'earliestReady', 'latestClose', 'minWindowMinutes'] as const;

describe('[AT-US-121-02] capabilities describe services, limits and pickup constraints', () => {
  it('[AT-US-121-02] a complete declaration has no issues', () => {
    expect(issuesOf(fakeCapabilities())).toEqual([]);
  });

  it.each(SERVICE_FIELDS)(
    '[AT-US-121-02] each service must list %s (canonical code, directions, content types, limits, divisors, cut-off with IANA zone, drop-off, pickup, DDP, paperless, label formats)',
    (field) => {
      expect(issuesOf(withService(without(fakeService(), field))).length).toBeGreaterThan(0);
    },
  );

  it.each(CARRIER_FIELDS)('[AT-US-121-02] the declaration must list %s', (field) => {
    expect(issuesOf(without(fakeCapabilities(), field)).length).toBeGreaterThan(0);
  });

  it.each(PICKUP_FIELDS)('[AT-US-121-02] pickup constraints must list %s', (field) => {
    expect(issuesOf(fakeCapabilities({ pickup: without(fakeCapabilities().pickup, field) as never })).length).toBeGreaterThan(0);
  });

  it('[AT-US-121-02] the volumetric divisor is declared per unit system and the cut-off carries an IANA zone', () => {
    expect(issuesOf(withService({ ...fakeService(), volumetricDivisor: { metric: 5000 } }))).toEqual([
      'services[0].volumetricDivisor.imperial must be a positive integer',
    ]);
    expect(issuesOf(withService({ ...fakeService(), bookingCutoff: { localTime: '17:00', timeZone: '+05:30' } }))).toEqual([
      'services[0].bookingCutoff.timeZone must be an IANA zone',
    ]);
    expect(issuesOf(withService({ ...fakeService(), bookingCutoff: { localTime: '24:00', timeZone: 'Asia/Kolkata' } }))).toEqual([
      'services[0].bookingCutoff.localTime must be HH:MM',
    ]);
  });
});

describe('capability declaration rules', () => {
  it('canonical service codes are carrier code plus service code (DR-B30) and unique', () => {
    expect(issuesOf(withService({ ...fakeService(), canonicalCode: 'EXPRESS' }))).toEqual([
      `services[0].canonicalCode must be ${FAKE_CARRIER}_EXPRESS (DR-B30: carrier code plus service code)`,
    ]);
    expect(issuesOf(withService({ ...fakeService(), carrierServiceCode: 'bad code' }))).toContain(
      'services[0].carrierServiceCode is not a valid carrier service code',
    );
    expect(issuesOf(withService({ ...fakeService(), carrierServiceCode: 7 }))).toContain(
      'services[0].carrierServiceCode is not a valid carrier service code',
    );
    expect(issuesOf(fakeCapabilities({ services: [fakeService(), fakeService()] }))).toEqual(['services has duplicate canonical codes']);
    expect(capabilityIssues(fakeCapabilities(), 'not a code')).toContain(
      'services[0].carrierServiceCode is not a valid carrier service code',
    );
  });

  it('label formats are document_format values only: raster formats are refused (ADR-0010 am. 11 item 3)', () => {
    expect(issuesOf(withService({ ...fakeService(), labelFormats: ['GIF'] }))).toEqual([
      'services[0].labelFormats[0] must be one of PDF_4X6 | PDF_A4 | PDF_LETTER | ZPL',
    ]);
    expect(issuesOf(withService({ ...fakeService(), labelFormats: [] }))).toEqual([
      'services[0].labelFormats must be a non-empty array of PDF_4X6 | PDF_A4 | PDF_LETTER | ZPL',
    ]);
    expect(issuesOf(withService({ ...fakeService(), labelFormats: ['ZPL', 'ZPL'] }))).toEqual(['services[0].labelFormats has duplicates']);
  });

  it('tiers, directions and content types come from the canonical catalogue', () => {
    expect(issuesOf(withService({ ...fakeService(), tier: 'PRIORITY' }))).toEqual([
      'services[0].tier must be one of EXPRESS | STANDARD | ECONOMY',
    ]);
    expect(issuesOf(withService({ ...fakeService(), directions: ['OUTBOUND'] }))).toEqual([
      'services[0].directions[0] must be one of EXPORT | IMPORT | DOMESTIC',
    ]);
    expect(issuesOf(withService({ ...fakeService(), contentTypes: ['PALLET'] }))).toEqual([
      'services[0].contentTypes[0] must be one of DOCUMENT | PARCEL',
    ]);
  });

  it('limits are positive integers and the shipment limit is not below the package limit', () => {
    expect(issuesOf(withService({ ...fakeService(), maxPackageWeightG: 2.5 }))).toEqual([
      'services[0].maxPackageWeightG must be a positive integer',
    ]);
    expect(issuesOf(withService({ ...fakeService(), maxShipmentWeightG: 1000, maxPackageWeightG: 2000 }))).toEqual([
      'services[0].maxShipmentWeightG must be >= maxPackageWeightG',
    ]);
    expect(issuesOf(withService({ ...fakeService(), maxDimensionsMm: { lengthMm: 0, widthMm: 1, heightMm: 1 } }))).toEqual([
      'services[0].maxDimensionsMm.lengthMm must be a positive integer',
    ]);
    expect(issuesOf(withService({ ...fakeService(), dropoff: 'yes' }))).toEqual(['services[0].dropoff must be a boolean']);
    expect(issuesOf(fakeCapabilities({ services: [] }))).toEqual(['services must be a non-empty array']);
    expect(issuesOf(fakeCapabilities({ services: [null as never] }))).toEqual(['services[0] must be an object']);
    expect(issuesOf(fakeCapabilities({ maxTrackingNumbersPerCall: 1001 }))).toEqual([
      'maxTrackingNumbersPerCall must be an integer 1..1000',
    ]);
    expect(issuesOf(withService({ ...fakeService(), bookingCutoff: null }))).toEqual(['services[0].bookingCutoff must be an object']);
  });

  it('pickup windows are ordered and the minimum window fits inside them', () => {
    const pickup = fakeCapabilities().pickup;
    expect(issuesOf(fakeCapabilities({ pickup: { ...pickup, earliestReady: '18:00', latestClose: '08:00' } }))).toEqual([
      'pickup.earliestReady must be before pickup.latestClose',
    ]);
    expect(issuesOf(fakeCapabilities({ pickup: { ...pickup, minWindowMinutes: 601 } }))).toEqual([
      'pickup.minWindowMinutes must fit between earliestReady and latestClose',
    ]);
    expect(issuesOf(fakeCapabilities({ pickup: { ...pickup, daysServed: [0, 8] } }))).toEqual([
      'pickup.daysServed must hold ISO weekdays 1..7',
    ]);
    expect(issuesOf(fakeCapabilities({ pickup: { ...pickup, daysServed: [1, 1] } }))).toEqual(['pickup.daysServed has duplicates']);
    expect(issuesOf(fakeCapabilities({ pickup: { ...pickup, daysServed: [] } }))).toEqual([
      'pickup.daysServed must be a non-empty array of ISO weekdays 1..7',
    ]);
    expect(issuesOf(fakeCapabilities({ pickup: { ...pickup, earliestReady: '8am', latestClose: 'late' } }))).toEqual([
      'pickup.earliestReady must be HH:MM',
      'pickup.latestClose must be HH:MM',
    ]);
    expect(issuesOf(fakeCapabilities({ pickup: null as never }))).toEqual(['pickup must be an object']);
  });

  it('unknown operation keys and non-object declarations are refused', () => {
    expect(issuesOf(fakeCapabilities({ operations: { ...fakeCapabilities().operations, availability: true } as never }))).toEqual([
      'operations.availability is not a declared operation',
    ]);
    expect(issuesOf(fakeCapabilities({ operations: null as never }))).toEqual([
      'operations must be an object with a boolean per declared operation',
    ]);
    expect(issuesOf('caps')).toEqual(['capabilities() must return an object']);
  });
});

describe('time helpers', () => {
  it('minutesOfDay reads HH:MM only', () => {
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('23:59')).toBe(1439);
    expect(minutesOfDay('7:00')).toBeUndefined();
    expect(minutesOfDay(700)).toBeUndefined();
  });

  it('property: every well-formed HH:MM maps to 60 * h + m', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }), (hours, minutes) => {
        const value = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        expect(minutesOfDay(value)).toBe(hours * 60 + minutes);
      }),
    );
  });

  it('isIanaTimeZone accepts zone names the runtime knows and refuses offsets and unknown names', () => {
    expect(isIanaTimeZone('Asia/Kolkata')).toBe(true);
    expect(isIanaTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isIanaTimeZone('UTC')).toBe(true);
    expect(isIanaTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isIanaTimeZone('+05:30')).toBe(false);
    expect(isIanaTimeZone(undefined)).toBe(false);
  });
});
