/**
 * Test support of the Mock carrier suites (test-only; `tests/` folders are excluded from coverage). Synthetic data
 * only: no real names, addresses or references.
 */
import type { LogFields } from '@platform/shared/logging';

import type { PackageSpec, PickupRequest, RateRequest, ShipmentRequest } from '../../../canonical/types.js';
import { type CarrierContext, createCarrierContext } from '../../../context.js';
import { createMockAdapter, type MockAdapterOptions, type MockCarrierAdapter } from '../mock-adapter.js';

export interface LoggedLine {
  readonly event: string;
  readonly fields: LogFields | undefined;
}

export interface Recorder {
  readonly lines: LoggedLine[];
  readonly logger: MockAdapterOptions['logger'];
}

/** A logger port that keeps every line. */
export function recorder(): Recorder {
  const lines: LoggedLine[] = [];
  return {
    lines,
    logger: {
      info: (event, fields) => {
        lines.push({ event, fields });
      },
    },
  };
}

export const CORRELATION_ID = 'demo-booking-0001';

export function mockContext(overrides: { correlationId?: string; mockScenario?: string; accountId?: string } = {}): CarrierContext {
  return createCarrierContext({
    account: { id: overrides.accountId ?? 'acct-mock-1', code: 'MOCK_DEFAULT', carrierCode: 'MOCK', environment: 'sandbox' },
    correlationId: overrides.correlationId ?? CORRELATION_ID,
    deadlineAt: new Date('2026-11-19T12:00:04Z'),
    ...(overrides.mockScenario === undefined ? {} : { mockScenario: overrides.mockScenario }),
  });
}

export function newMock(options: Partial<MockAdapterOptions> = {}): { adapter: MockCarrierAdapter; log: Recorder } {
  const log = recorder();
  return { adapter: createMockAdapter({ logger: log.logger, ...options }), log };
}

export const PARCEL_2KG: PackageSpec = { packageType: 'PARCEL_BOX', weightG: 2000, lengthMm: 300, widthMm: 200, heightMm: 100 };

/** US-122 scenario 1: a parcel US 10001 to IN 400001, 2 kg, 30x20x10 cm. */
export function rateRequest(overrides: Partial<RateRequest> = {}): RateRequest {
  return {
    origin: { countryCode: 'US', postalCode: '10001', city: 'New York' },
    destination: { countryCode: 'IN', postalCode: '400001', city: 'Mumbai' },
    packages: [PARCEL_2KG],
    contentType: 'PARCEL',
    direction: 'EXPORT',
    shipDate: '2026-12-01',
    ...overrides,
  };
}

export function shipmentRequest(overrides: Partial<ShipmentRequest> = {}): ShipmentRequest {
  const rates = rateRequest();
  return {
    clientReference: 'SHP-123-A1',
    serviceCode: 'MOCK_EXPRESS',
    shipper: { name: 'Synthetic Sender', address: rates.origin },
    recipient: { name: 'Synthetic Recipient', address: rates.destination },
    packages: rates.packages,
    contentType: 'PARCEL',
    direction: 'EXPORT',
    shipDate: rates.shipDate,
    incoterm: 'DAP',
    labelFormats: ['PDF_4X6'],
    ...overrides,
  };
}

export function pickupRequest(overrides: Partial<PickupRequest> = {}): PickupRequest {
  return {
    shipments: [{ trackingNumber: 'MOCK000000000001' }],
    address: { countryCode: 'US', postalCode: '10001' },
    contact: { name: 'Synthetic Contact', address: { countryCode: 'US', postalCode: '10001' } },
    date: '2026-12-01',
    readyTime: '09:00',
    closeTime: '17:00',
    timeZone: 'America/New_York',
    ...overrides,
  };
}

/** The text of a PDF or ZPL label as latin1 (the labels are ASCII). */
export const textOf = (content: Uint8Array): string => Buffer.from(content).toString('latin1');
