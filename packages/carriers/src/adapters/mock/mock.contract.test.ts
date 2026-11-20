/**
 * Contract tests of the deterministic Mock carrier (TASK-079): the six scenarios of US-122, the capability declaration
 * on the real Mock (AT-US-121-02), registration through the registry and guard, and the honest-egress property. The
 * `carrier-contract` suite runner of `tools/quality/required-suites.json` names `packages/carriers/test/contract`; the
 * package tsconfig includes `src` only, so the tests live here (qa-lead reconciles the runner text).
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { capabilityIssues } from '../../capabilities.js';
import { deriveCarrierEgressRules } from '../../egress.js';
import { CarrierError } from '../../errors.js';
import { createLabelDocument, isPdf, isZpl } from '../../labels.js';
import { createCarrierRegistry } from '../../registry.js';
import { monitorNetwork, type NetworkMonitor } from '../../tests/network-monitor.js';
import { mockCapabilities } from './capabilities.js';
import { MOCK_EGRESS, createMockAdapter } from './index.js';
import { MOCK_LABEL_MARKER } from './labels.js';
import { mockContext, newMock, PARCEL_2KG, rateRequest, recorder, shipmentRequest, textOf } from './tests/support.js';

let network: NetworkMonitor;
beforeEach(() => {
  network = monitorNetwork();
});
afterEach(() => {
  const attempts = network.attempts();
  network.restore();
  expect(attempts).toBe(0); // the Mock never opens a connection
});

const SERVICES = ['MOCK_EXPRESS', 'MOCK_STANDARD', 'MOCK_ECONOMY'];
const totals = (quotes: readonly { serviceCode: string; totalCharge: { amountMinor: number } }[]): Map<string, number> =>
  new Map(quotes.map((quote) => [quote.serviceCode, quote.totalCharge.amountMinor]));

describe('Mock carrier (US-122)', () => {
  it('[AT-US-122-01] three services priced deterministically, within their transit ranges, byte-identical on repeat', async () => {
    const { adapter } = newMock();
    const first = await adapter.getRates(rateRequest(), mockContext());
    const second = await adapter.getRates(rateRequest(), mockContext());

    expect(first.quotes.map((quote) => quote.serviceCode)).toEqual(SERVICES);
    const transit = Object.fromEntries(first.quotes.map((quote) => [quote.serviceCode, [quote.transitDaysMin, quote.transitDaysMax]]));
    expect(transit).toEqual({ MOCK_EXPRESS: [1, 3], MOCK_STANDARD: [3, 5], MOCK_ECONOMY: [5, 9] });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    for (const quote of first.quotes) {
      expect(quote.totalCharge.amountMinor).toBe(quote.baseCharge.amountMinor + (quote.surcharges[0]?.amount.amountMinor ?? 0));
      expect(quote.totalCharge.currency).toBe('USD');
    }
    // a 2 kg parcel (volumetric 1.2 kg) on the long lane: express > standard > economy
    const price = totals(first.quotes);
    expect(price.get('MOCK_EXPRESS') ?? 0).toBeGreaterThan(price.get('MOCK_STANDARD') ?? Infinity);
    expect(price.get('MOCK_STANDARD') ?? 0).toBeGreaterThan(price.get('MOCK_ECONOMY') ?? Infinity);
    expect(first.quotes[0]?.estimatedDelivery).toBe('2026-12-04T00:00:00.000Z');
  });

  it('[AT-US-122-02] price changes only with weight, zone or service (2.0 kg vs 2.5 kg, repeated)', async () => {
    const { adapter } = newMock();
    const heavier = { ...PARCEL_2KG, weightG: 2500 };
    const two = await adapter.getRates(rateRequest(), mockContext());
    const twoAgain = await adapter.getRates(rateRequest(), mockContext());
    const twoAndHalf = await adapter.getRates(rateRequest({ packages: [heavier] }), mockContext());
    const twoAndHalfAgain = await adapter.getRates(rateRequest({ packages: [heavier] }), mockContext());

    expect(totals(twoAgain.quotes)).toEqual(totals(two.quotes));
    expect(totals(twoAndHalfAgain.quotes)).toEqual(totals(twoAndHalf.quotes));
    for (const service of SERVICES) {
      expect(totals(twoAndHalf.quotes).get(service) ?? 0).toBeGreaterThanOrEqual(totals(two.quotes).get(service) ?? Infinity);
    }
    // every field that is not weight, zone or service leaves the price alone
    const other = await adapter.getRates(
      rateRequest({
        contentType: 'DOCUMENT',
        shipDate: '2027-03-15',
        origin: { countryCode: 'US', postalCode: '90210', residential: true },
      }),
      mockContext({ correlationId: 'another-correlation-1', accountId: 'acct-other' }),
    );
    expect(totals(other.quotes)).toEqual(totals(two.quotes));
  });

  it('[AT-US-122-02] property: price is monotone in billable weight, higher in a farther zone, and a function of its inputs', async () => {
    const { adapter } = newMock();
    const priced = async (weightG: number, destination: string): Promise<Map<string, number>> =>
      totals(
        (
          await adapter.getRates(
            rateRequest({ packages: [{ ...PARCEL_2KG, weightG }], destination: { countryCode: destination } }),
            mockContext(),
          )
        ).quotes,
      );
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 60_000 }), fc.integer({ min: 0, max: 5000 }), async (weightG, extraG) => {
        const lighter = await priced(weightG, 'IN');
        const heavier = await priced(weightG + extraG, 'IN');
        for (const service of SERVICES) expect(heavier.get(service) ?? 0).toBeGreaterThanOrEqual(lighter.get(service) ?? Infinity);
        expect(await priced(weightG, 'IN')).toEqual(lighter);
        // domestic (zone 1) is never dearer than the far lane (zone 4)
        const domestic = await priced(weightG, 'US');
        for (const service of SERVICES) expect(domestic.get(service) ?? Infinity).toBeLessThanOrEqual(lighter.get(service) ?? 0);
      }),
      { numRuns: 60 },
    );
  });

  it('[AT-US-122-03] tracking number and label are stable for a client reference; the label carries the marker', async () => {
    const { adapter } = newMock();
    const first = await adapter.createShipment(shipmentRequest(), mockContext());
    const second = await adapter.createShipment(shipmentRequest(), mockContext());

    expect(first.ref.trackingNumber).toMatch(/^MOCK\d{12}$/u);
    expect(second.ref.trackingNumber).toBe(first.ref.trackingNumber);
    expect(first.ref.clientReference).toBe('SHP-123-A1');
    expect(first.labels).toHaveLength(1);
    expect(Buffer.from(second.labels[0]?.content ?? []).equals(Buffer.from(first.labels[0]?.content ?? []))).toBe(true);
    expect(textOf(first.labels[0]?.content ?? new Uint8Array())).toContain(MOCK_LABEL_MARKER);
    expect(first.serviceCode).toBe('MOCK_EXPRESS');
    expect(first.charge?.currency).toBe('USD');
  });

  it('[AT-US-122-03] property: the tracking number is a pure function of the client reference, distinct references differ', async () => {
    const { adapter } = newMock();
    const numberOf = async (clientReference: string): Promise<string> =>
      (await adapter.createShipment(shipmentRequest({ clientReference }), mockContext())).ref.trackingNumber;
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 40 }), fc.string({ minLength: 1, maxLength: 40 }), async (a, b) => {
        expect(await numberOf(a)).toBe(await numberOf(a));
        if (a !== b) expect(await numberOf(a)).not.toBe(await numberOf(b));
      }),
      { numRuns: 60 },
    );
  });

  it('[AT-US-122-03] a multi-package shipment gets stable piece-level numbers and the requested label formats', async () => {
    const { adapter } = newMock();
    const request = shipmentRequest({ packages: [PARCEL_2KG, PARCEL_2KG], labelFormats: ['PDF_A4', 'ZPL', 'PDF_A4'] });
    const confirmation = await adapter.createShipment(request, mockContext());

    expect(confirmation.labels.map(({ format }) => format)).toEqual(['PDF_A4', 'ZPL']);
    expect(confirmation.packages?.map(({ seq }) => seq)).toEqual([1, 2]);
    expect(confirmation.packages?.[0]?.trackingNumber).toBe(confirmation.ref.trackingNumber);
    expect(confirmation.packages?.[1]?.trackingNumber).not.toBe(confirmation.ref.trackingNumber);
    expect((await adapter.createShipment(request, mockContext())).packages).toEqual(confirmation.packages);
    // no format asked for: the default 4x6 PDF
    const defaulted = await adapter.createShipment(shipmentRequest({ labelFormats: [] }), mockContext());
    expect(defaulted.labels.map(({ format }) => format)).toEqual(['PDF_4X6']);
  });

  it('[AT-US-122-04] documents, imports and domestic lanes are served', async () => {
    const { adapter } = newMock();
    const document = await adapter.getRates(rateRequest({ contentType: 'DOCUMENT', direction: 'EXPORT' }), mockContext());
    const importLane = await adapter.getRates(
      rateRequest({
        origin: { countryCode: 'IN', postalCode: '400001' },
        destination: { countryCode: 'US', postalCode: '10001' },
        direction: 'IMPORT',
      }),
      mockContext(),
    );
    const domestic = await adapter.getRates(
      rateRequest({ destination: { countryCode: 'US', postalCode: '94105' }, direction: 'DOMESTIC' }),
      mockContext(),
    );
    for (const answer of [document, importLane, domestic]) expect(answer.quotes.length).toBeGreaterThanOrEqual(1);
    // imports price like exports on the same lane (symmetric zones)
    const exportLane = await adapter.getRates(rateRequest(), mockContext());
    expect(totals(importLane.quotes)).toEqual(totals(exportLane.quotes));
  });

  it('[AT-US-122-05] optional operations are supported except landed cost', () => {
    const { adapter } = newMock();
    const { operations } = adapter.capabilities();
    expect(operations.validateAddress).toBe(true);
    expect(operations.findServicePoints).toBe(true);
    expect(operations.uploadCustomsDocuments).toBe(true);
    expect(operations.estimateLandedCost).toBe(false);
    expect(Object.hasOwn(adapter, 'estimateLandedCost')).toBe(false);
  });

  it('[AT-US-122-06] a request outside the Mock limits returns no service with a reason, not an exception', async () => {
    const { adapter } = newMock();
    const heavy = await adapter.getRates(rateRequest({ packages: [{ ...PARCEL_2KG, weightG: 1_000_000 }] }), mockContext());
    expect(heavy).toEqual({ quotes: [], noServiceReason: 'WEIGHT_EXCEEDED' });
    const many = await adapter.getRates(
      rateRequest({ packages: Array.from({ length: 5 }, () => ({ ...PARCEL_2KG, weightG: 69_000 })) }),
      mockContext(),
    );
    expect(many.noServiceReason).toBe('WEIGHT_EXCEEDED');
    const long = await adapter.getRates(rateRequest({ packages: [{ ...PARCEL_2KG, lengthMm: 1300 }] }), mockContext());
    expect(long).toEqual({ quotes: [], noServiceReason: 'DIMENSION_EXCEEDED' });
    // dimensions are compared in any orientation
    const rotated = await adapter.getRates(
      rateRequest({ packages: [{ ...PARCEL_2KG, lengthMm: 100, widthMm: 1200, heightMm: 800 }] }),
      mockContext(),
    );
    expect(rotated.quotes).toHaveLength(3);
    expect((await adapter.getRates(rateRequest({ packages: [] }), mockContext())).noServiceReason).toBe('SERVICE_UNAVAILABLE');
  });

  it('[AT-US-121-02] capabilityIssues accepts the real Mock declaration and rejects its mutations', () => {
    expect(capabilityIssues(mockCapabilities(), 'MOCK')).toEqual([]);
    expect(capabilityIssues(mockCapabilities(), 'OTHER')).not.toEqual([]); // canonical codes are bound to the carrier
    const missing: Record<string, unknown> = { ...mockCapabilities().operations };
    delete missing.recoverLabel;
    expect(capabilityIssues({ ...mockCapabilities(), operations: missing }, 'MOCK')).toEqual(['operations.recoverLabel must be a boolean']);
    expect(capabilityIssues({ ...mockCapabilities(), services: [] }, 'MOCK')).toEqual(['services must be a non-empty array']);
  });

  it('[AT-US-121-02] the Mock registers through the registry; unsupported landed cost answers CAPABILITY_NOT_SUPPORTED with no I/O', async () => {
    const log = recorder();
    const registry = createCarrierRegistry([createMockAdapter({ logger: log.logger })], { logger: { warn: () => undefined } });
    const guarded = registry.get('MOCK');
    expect(registry.codes).toEqual(['MOCK']);
    expect(guarded.capabilities().services.map(({ canonicalCode }) => canonicalCode)).toEqual(SERVICES);

    await expect(guarded.estimateLandedCost({ rate: rateRequest(), items: [] }, mockContext())).rejects.toMatchObject({
      code: 'CAPABILITY_NOT_SUPPORTED',
    });
    expect(log.lines).toHaveLength(0); // the guard answered; the adapter was never entered
    const rates = await guarded.getRates(rateRequest(), mockContext());
    expect(rates.quotes).toHaveLength(3);
    expect(log.lines).toHaveLength(1);
  });

  it('[AT-US-121-03] the egress table is empty in both environments: no rule is derived for the Mock', () => {
    expect(MOCK_EGRESS).toEqual({ sandbox: [], production: [] });
    const rules = deriveCarrierEgressRules({
      accounts: [{ code: 'MOCK_DEFAULT', carrierCode: 'MOCK', environment: 'sandbox', enabled: true }],
      egress: { MOCK: MOCK_EGRESS },
      appEnv: 'local',
    });
    expect(rules).toEqual([]);
  });

  it('every operation answers with no network access (the monitor fails the test on any socket)', async () => {
    const { adapter } = newMock();
    const ctx = mockContext();
    const created = await adapter.createShipment(shipmentRequest(), ctx);
    await adapter.getRates(rateRequest(), ctx);
    await adapter.cancelShipment(created.ref, ctx);
    const pickup = await adapter.schedulePickup(
      {
        shipments: [created.ref],
        address: { countryCode: 'US', postalCode: '10001' },
        contact: { name: 'Synthetic Contact', address: { countryCode: 'US' } },
        date: '2026-12-01',
        readyTime: '09:00',
        closeTime: '17:00',
        timeZone: 'America/New_York',
      },
      ctx,
    );
    await adapter.cancelPickup(pickup.ref, ctx);
    await adapter.track([created.ref.trackingNumber], ctx);
    await adapter.validateAddress({ countryCode: 'US', postalCode: '10001' }, ctx);
    await adapter.findServicePoints({ address: { countryCode: 'US', postalCode: '10001' } }, ctx);
    await adapter.uploadCustomsDocuments({ ref: created.ref, documents: [{ documentType: 'INVOICE', content: new Uint8Array([1]) }] }, ctx);
    await adapter.recoverLabel(created.ref, ['PDF_4X6'], ctx);
    expect(adapter.callRecords()).toHaveLength(10);
    expect(network.attempts()).toBe(0);
  });

  it('[AT-US-122-03] the guarded createShipment keeps every Mock label (the guard re-check drops none)', async () => {
    const dropped: string[] = [];
    const registry = createCarrierRegistry([newMock().adapter], { logger: { warn: (event) => void dropped.push(event) } });
    const confirmation = await registry
      .get('MOCK')
      .createShipment(shipmentRequest({ labelFormats: ['PDF_4X6', 'PDF_A4', 'PDF_LETTER', 'ZPL'] }), mockContext());
    expect(confirmation.labels.map(({ format }) => format)).toEqual(['PDF_4X6', 'PDF_A4', 'PDF_LETTER', 'ZPL']);
    expect(dropped).toEqual([]);
    for (const label of confirmation.labels) {
      expect(() => createLabelDocument(label.format, label.content)).not.toThrow();
      expect(label.format === 'ZPL' ? isZpl(label.content) : isPdf(label.content)).toBe(true);
    }
  });

  it('refuses a malformed request at the boundary: unknown service, bad country, invalid packages', async () => {
    const { adapter } = newMock();
    await expect(adapter.createShipment(shipmentRequest({ serviceCode: 'MOCK_PLATINUM' }), mockContext())).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    await expect(adapter.getRates(rateRequest({ destination: { countryCode: 'India' } }), mockContext())).rejects.toBeInstanceOf(
      CarrierError,
    );
    await expect(adapter.getRates(rateRequest({ packages: [{ ...PARCEL_2KG, weightG: 0 }] }), mockContext())).rejects.toMatchObject({
      name: 'CarrierContractError',
    });
    await expect(adapter.createShipment(shipmentRequest({ clientReference: '' }), mockContext())).rejects.toMatchObject({
      name: 'CarrierContractError',
    });
    await expect(
      adapter.createShipment(shipmentRequest({ packages: [{ ...PARCEL_2KG, weightG: 1_000_000 }] }), mockContext()),
    ).rejects.toMatchObject({
      code: 'WEIGHT_EXCEEDED',
    });
    await expect(adapter.createShipment(shipmentRequest({ packages: [] }), mockContext())).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });
});
