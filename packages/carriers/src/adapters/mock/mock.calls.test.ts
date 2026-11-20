/**
 * The call log and the latency hook of the Mock carrier: AT-US-008-03 (Mock hop, D-062) and the runtime twin of the
 * T-83 lint (D-ARCH-106), plus the remaining operations (cancel, pickup, tracking baseline, address, service points,
 * customs documents, label recovery).
 */
import { describe, expect, it, jest } from '@jest/globals';
import { outboundCallFields } from '@platform/shared/logging';

import { CARRIER_OPERATIONS, type CarrierOperation } from '../../operations.js';
import { createMockAdapter } from './index.js';
import { MOCK_LABEL_MARKER } from './labels.js';
import { CORRELATION_ID, mockContext, newMock, pickupRequest, rateRequest, recorder, shipmentRequest, textOf } from './tests/support.js';

describe('Mock call log (AT-US-008-03, Mock hop)', () => {
  it('[AT-US-008-03] every operation emits exactly one carrier.call line through outboundCallFields, with the correlation ID and no body', async () => {
    const { adapter, log } = newMock({
      monotonicMs: (() => {
        let now = 0;
        return () => (now += 7);
      })(),
    });
    const ctx = mockContext({ correlationId: 'demo-booking-0001' });
    const created = await adapter.createShipment(shipmentRequest(), ctx);
    const calls: [CarrierOperation, () => Promise<unknown>][] = [
      ['getRates', () => adapter.getRates(rateRequest(), ctx)],
      ['createShipment', () => adapter.createShipment(shipmentRequest(), ctx)],
      ['cancelShipment', () => adapter.cancelShipment(created.ref, ctx)],
      ['schedulePickup', () => adapter.schedulePickup(pickupRequest(), ctx)],
      ['cancelPickup', () => adapter.cancelPickup({ confirmationNumber: 'MOCKPU0000000001', date: '2026-12-01' }, ctx)],
      ['track', () => adapter.track([created.ref.trackingNumber], ctx)],
      ['validateAddress', () => adapter.validateAddress({ countryCode: 'US', postalCode: '10001' }, ctx)],
      ['findServicePoints', () => adapter.findServicePoints({ address: { countryCode: 'US', postalCode: '10001' } }, ctx)],
      [
        'uploadCustomsDocuments',
        () =>
          adapter.uploadCustomsDocuments({ ref: created.ref, documents: [{ documentType: 'INVOICE', content: new Uint8Array([1]) }] }, ctx),
      ],
      ['recoverLabel', () => adapter.recoverLabel(created.ref, ['ZPL'], ctx)],
    ];
    log.lines.length = 0;
    for (const [operation, call] of calls) {
      const before = log.lines.length;
      await call();
      expect(log.lines).toHaveLength(before + 1); // exactly one line per operation
      const line = log.lines.at(-1);
      expect(line?.event).toBe('carrier.call');
      expect(line?.fields).toEqual(
        outboundCallFields({
          carrierCode: 'MOCK',
          accountId: 'acct-mock-1',
          operation,
          routeTemplate: line?.fields?.route_template as string,
          durationMs: 7,
          correlationId: 'demo-booking-0001',
        }),
      );
      expect(line?.fields?.correlation_id).toBe('demo-booking-0001');
      expect(String(line?.fields?.route_template)).toMatch(/^\/mock\/v1\//u);
    }
    // the record of the same calls carries the same correlation ID, for the saga's carrier_call audit entry
    const records = adapter.callRecords().slice(1);
    expect(records.map(({ operation }) => operation)).toEqual(calls.map(([operation]) => operation));
    expect(
      records.every(
        (record) => record.correlationId === 'demo-booking-0001' && record.outcome === 'OK' && record.accountId === 'acct-mock-1',
      ),
    ).toBe(true);
  });

  it('[AT-US-008-03] the line holds no request or response content, and a failed call is logged with its canonical code', async () => {
    const { adapter, log } = newMock();
    await adapter.createShipment(shipmentRequest(), mockContext());
    await expect(adapter.createShipment(shipmentRequest({ serviceCode: 'MOCK_NOPE' }), mockContext())).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    await expect(adapter.createShipment(shipmentRequest({ clientReference: '' }), mockContext())).rejects.toBeDefined();

    const serialised = JSON.stringify(log.lines);
    for (const forbidden of ['Synthetic', 'SHP-123-A1', '10001', '400001', 'MOCK0', MOCK_LABEL_MARKER])
      expect(serialised).not.toContain(forbidden);
    expect(Object.keys(log.lines[0]?.fields ?? {}).sort()).toEqual([
      'account_id',
      'carrier_code',
      'correlation_id',
      'duration_ms',
      'error_code',
      'operation',
      'route_template',
      'status',
    ]);
    expect(log.lines.map((line) => line.fields?.error_code)).toEqual([null, 'SERVICE_UNAVAILABLE', 'CARRIER_UNKNOWN_ERROR']);
    expect(adapter.callRecords().map(({ outcome }) => outcome)).toEqual(['OK', 'SERVICE_UNAVAILABLE', 'CARRIER_UNKNOWN_ERROR']);
  });

  it('keeps a bounded call record (oldest first dropped) and returns copies', async () => {
    const { adapter } = newMock({ maxCallRecords: 2 });
    for (const correlationId of ['corr-0000000001', 'corr-0000000002', 'corr-0000000003']) {
      await adapter.getRates(rateRequest(), mockContext({ correlationId }));
    }
    const records = adapter.callRecords();
    expect(records.map(({ correlationId }) => correlationId)).toEqual(['corr-0000000002', 'corr-0000000003']);
    expect(adapter.callRecords()).not.toBe(records);
  });

  it('covers every operation of the contract except the declared-unsupported landed cost', () => {
    const { adapter } = newMock();
    const missing = CARRIER_OPERATIONS.filter(
      (operation) => typeof (adapter as unknown as Record<string, unknown>)[operation] !== 'function',
    );
    expect(missing).toEqual(['estimateLandedCost']);
  });
});

describe('Mock latency hook (D-ARCH-106, DR-B29)', () => {
  it('[D-ARCH-106] waits the directed latency before answering when scenarios are enabled, on every operation', async () => {
    const waits: number[] = [];
    const { adapter } = newMock({ scenariosEnabled: true, sleep: (ms) => Promise.resolve(void waits.push(ms)) });
    const ctx = mockContext({ mockScenario: 'latency=6000' });
    await adapter.getRates(rateRequest(), ctx);
    await adapter.track(['MOCK000000000001'], ctx);
    expect(waits).toEqual([6000, 6000]);
  });

  it('[D-ARCH-106] really delays the call by the directed time (default timer)', async () => {
    const { adapter } = newMock({ scenariosEnabled: true });
    const started = performance.now();
    await adapter.getRates(rateRequest(), mockContext({ mockScenario: 'fail=booking;latency=60' }));
    expect(performance.now() - started).toBeGreaterThanOrEqual(55);
  });

  it('[D-ARCH-106] the logged duration includes the latency', async () => {
    let now = 0;
    const { adapter, log } = newMock({
      scenariosEnabled: true,
      monotonicMs: () => now,
      sleep: (ms) => {
        now += ms;
        return Promise.resolve();
      },
    });
    await adapter.getRates(rateRequest(), mockContext({ mockScenario: 'latency=1500' }));
    expect(log.lines[0]?.fields?.duration_ms).toBe(1500);
  });

  it('[D-ARCH-106] directives are ignored when scenarios are disabled (the default), and malformed ones never delay', async () => {
    const sleep = jest.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
    const disabled = newMock({ sleep }).adapter;
    await disabled.getRates(rateRequest(), mockContext({ mockScenario: 'latency=6000' }));
    const enabled = newMock({ scenariosEnabled: true, sleep }).adapter;
    for (const scenario of ['latency=30001', 'latency=-5', 'latency=abc', 'latency=', 'fail=rates', undefined]) {
      await enabled.getRates(rateRequest(), mockContext(scenario === undefined ? {} : { mockScenario: scenario }));
    }
    await enabled.getRates(rateRequest(), mockContext({ mockScenario: 'latency=0' }));
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('Mock operations', () => {
  it('cancels a Mock shipment and refuses a number it never issued', async () => {
    const { adapter } = newMock();
    const created = await adapter.createShipment(shipmentRequest(), mockContext());
    expect(await adapter.cancelShipment(created.ref, mockContext())).toEqual({ cancelled: true });
    expect(await adapter.cancelShipment({ trackingNumber: '1Z999AA10123456784' }, mockContext())).toEqual({
      cancelled: false,
      reason: 'CANNOT_VOID',
    });
  });

  it('schedules a pickup deterministically and cancels it; unserved days and windows are PICKUP_UNAVAILABLE', async () => {
    const { adapter } = newMock();
    const first = await adapter.schedulePickup(pickupRequest(), mockContext());
    const second = await adapter.schedulePickup(pickupRequest(), mockContext());
    expect(first).toEqual(second);
    expect(first.ref.confirmationNumber).toMatch(/^MOCKPU\d{10}$/u);
    expect(first).toMatchObject({ readyTime: '09:00', closeTime: '17:00', ref: { date: '2026-12-01' } });
    expect(await adapter.cancelPickup(first.ref, mockContext())).toEqual({ cancelled: true });
    expect(await adapter.cancelPickup({ confirmationNumber: 'PU-1', date: '2026-12-01' }, mockContext())).toEqual({
      cancelled: false,
      reason: 'PICKUP_UNAVAILABLE',
    });
    const other = await adapter.schedulePickup(pickupRequest({ closeTime: '16:00' }), mockContext());
    expect(other.ref.confirmationNumber).not.toBe(first.ref.confirmationNumber);

    for (const bad of [
      pickupRequest({ date: '2026-12-05' }), // Saturday
      pickupRequest({ date: '2026-12-5' }),
      pickupRequest({ date: '2026-13-45' }),
      pickupRequest({ readyTime: '07:00' }),
      pickupRequest({ closeTime: '19:00' }),
      pickupRequest({ readyTime: '09:00', closeTime: '10:00' }),
      pickupRequest({ readyTime: '9am' }),
      pickupRequest({ shipments: [] }),
    ]) {
      await expect(adapter.schedulePickup(bad, mockContext())).rejects.toMatchObject({ code: 'PICKUP_UNAVAILABLE' });
    }
  });

  it('tracks a Mock number along the happy path with stable events and reports an unknown number as not found', async () => {
    const { adapter } = newMock();
    const created = await adapter.createShipment(shipmentRequest(), mockContext());
    const number = created.ref.trackingNumber;
    const [found, unknown] = await adapter.track([number, 'NOTMINE123'], mockContext());

    expect(found?.found).toBe(true);
    expect(found?.events.map(({ status }) => status)).toEqual([
      'INFO_RECEIVED',
      'PICKED_UP',
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ]);
    expect(found?.events.every((event) => !event.unmapped && event.carrierEventId?.startsWith(number) === true)).toBe(true);
    expect(found?.events[0]?.occurredAt).toBe('2026-01-05T09:00:00.000Z');
    expect(new Set(found?.events.map(({ carrierEventId }) => carrierEventId)).size).toBe(5);
    expect(unknown).toEqual({ trackingNumber: 'NOTMINE123', found: false, events: [] });
    expect(await adapter.track([number], mockContext())).toEqual([found]);

    const anchored = newMock({ trackingStart: '2027-02-01T00:00:00.000Z' }).adapter;
    expect((await anchored.track([number], mockContext()))[0]?.events[0]?.occurredAt).toBe('2027-02-01T00:00:00.000Z');
    await expect(
      adapter.track(
        Array.from({ length: 31 }, () => number),
        mockContext(),
      ),
    ).rejects.toMatchObject({ name: 'CarrierContractError' });
  });

  it('validates addresses deterministically', async () => {
    const { adapter } = newMock();
    expect(await adapter.validateAddress({ countryCode: 'in', postalCode: '400001' }, mockContext())).toEqual({
      valid: true,
      suggestions: [],
    });
    expect(await adapter.validateAddress({ countryCode: 'IN' }, mockContext())).toEqual({
      valid: false,
      suggestions: [],
      reason: 'POSTCODE_INVALID',
    });
    expect(await adapter.validateAddress({ countryCode: 'IN', postalCode: '!!' }, mockContext())).toMatchObject({
      reason: 'POSTCODE_INVALID',
    });
    expect(await adapter.validateAddress({ countryCode: 'India', postalCode: '400001' }, mockContext())).toMatchObject({
      reason: 'INVALID_ADDRESS',
    });
  });

  it('finds service points: stable ids, increasing distance, limit and radius honoured', async () => {
    const { adapter } = newMock();
    const query = { address: { countryCode: 'US', postalCode: '10001' } };
    const points = await adapter.findServicePoints(query, mockContext());
    expect(points).toHaveLength(3);
    expect(points.map(({ distanceM }) => distanceM)).toEqual([400, 1300, 2800]);
    expect(points[0]?.id).toMatch(/^MOCKSP\d{6}$/u);
    expect(await adapter.findServicePoints(query, mockContext())).toEqual(points);
    expect(await adapter.findServicePoints({ ...query, limit: 50 }, mockContext())).toHaveLength(10);
    expect(await adapter.findServicePoints({ ...query, limit: 0 }, mockContext())).toEqual([]);
    expect(await adapter.findServicePoints({ ...query, radiusM: 1500 }, mockContext())).toHaveLength(2);
    expect((await adapter.findServicePoints({ address: { countryCode: 'US' } }, mockContext()))[0]?.address).toEqual({ countryCode: 'US' });
  });

  it('accepts customs documents and refuses an empty list or an empty document', async () => {
    const { adapter } = newMock();
    const ref = { trackingNumber: 'MOCK000000000001' };
    await expect(
      adapter.uploadCustomsDocuments({ ref, documents: [{ documentType: 'INVOICE', content: new Uint8Array([1, 2]) }] }, mockContext()),
    ).resolves.toBeUndefined();
    await expect(adapter.uploadCustomsDocuments({ ref, documents: [] }, mockContext())).rejects.toMatchObject({
      code: 'CUSTOMS_DATA_INVALID',
    });
    await expect(
      adapter.uploadCustomsDocuments({ ref, documents: [{ documentType: 'INVOICE', content: new Uint8Array() }] }, mockContext()),
    ).rejects.toMatchObject({ code: 'CUSTOMS_DATA_INVALID' });
  });

  it('recovers exactly the requested label formats, identical to the create-time label', async () => {
    const { adapter } = newMock();
    const created = await adapter.createShipment(shipmentRequest({ labelFormats: ['PDF_A4'] }), mockContext());
    const [recovered, ...rest] = await adapter.recoverLabel(created.ref, ['PDF_A4', 'PDF_A4'], mockContext());
    expect(rest).toEqual([]);
    expect(recovered?.content).toEqual(created.labels[0]?.content);
    expect(textOf(recovered?.content ?? new Uint8Array())).toContain(MOCK_LABEL_MARKER);
    expect(await adapter.recoverLabel(created.ref, [], mockContext())).toEqual([]);
    await expect(adapter.recoverLabel({ trackingNumber: 'X1' }, ['ZPL'], mockContext())).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('uses only injected seams for time: the defaults work and are the only clock reads', async () => {
    const log = recorder();
    const adapter = createMockAdapter({ logger: log.logger });
    await adapter.getRates(rateRequest(), mockContext({ correlationId: CORRELATION_ID }));
    expect(log.lines[0]?.fields?.duration_ms).toEqual(expect.any(Number));
  });
});
