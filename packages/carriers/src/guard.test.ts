import { Socket } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

// Runtime imports of the type-only contract modules, so coverage measures them as loaded (they compile to nothing).
import './adapter.js';
import './canonical/types.js';

import type { CarrierAdapter, GuardedCarrierAdapter } from './adapter.js';
import type { CarrierCapabilities } from './capabilities.js';
import type { CarrierShipmentRef, PickupRequest, RateRequest, ShipmentRequest } from './canonical/types.js';
import type { CarrierContext } from './context.js';
import { CarrierContractError, CarrierError } from './errors.js';
import { guardAdapter, registrationIssues } from './guard.js';
import { CARRIER_OPERATIONS, type CarrierOperation, DECLARED_OPERATIONS, OPTIONAL_OPERATIONS, REQUIRED_OPERATIONS } from './operations.js';
import { createCarrierRegistry } from './registry.js';
import { ALL_SUPPORTED, createFakeAdapter, FAKE_CARRIER, fakeCapabilities, fakeContext } from './tests/fake-adapter.js';
import { monitorNetwork, type NetworkMonitor } from './tests/network-monitor.js';

/** A shallow copy of `adapter` without `key`. */
function omit(adapter: object, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...adapter };
  delete copy[key];
  return copy;
}

const address = { countryCode: 'US', postalCode: '10001', city: 'New York' };
const party = { name: 'Synthetic Sender', address };
const pkg = { weightG: 2000, lengthMm: 300, widthMm: 200, heightMm: 100 };
const rateRequest: RateRequest = {
  origin: address,
  destination: { countryCode: 'IN', postalCode: '400001' },
  packages: [pkg],
  contentType: 'PARCEL',
  direction: 'EXPORT',
  shipDate: '2026-11-20',
};
const shipmentRequest: ShipmentRequest = {
  clientReference: 'SHP-123-A1',
  serviceCode: `${FAKE_CARRIER}_EXPRESS`,
  shipper: party,
  recipient: { ...party, address: { countryCode: 'IN', postalCode: '400001' } },
  packages: [pkg],
  contentType: 'PARCEL',
  direction: 'EXPORT',
  shipDate: '2026-11-20',
  labelFormats: ['PDF_4X6'],
};
const shipmentRef: CarrierShipmentRef = { trackingNumber: 'FAKE0001' };
const pickupRequest: PickupRequest = {
  shipments: [shipmentRef],
  address,
  contact: party,
  date: '2026-11-20',
  readyTime: '09:00',
  closeTime: '17:00',
  timeZone: 'America/New_York',
};

/** Calls `operation` on `adapter` with canonical arguments. */
function invoke(adapter: GuardedCarrierAdapter, operation: CarrierOperation, ctx: CarrierContext): Promise<unknown> {
  switch (operation) {
    case 'getRates':
      return adapter.getRates(rateRequest, ctx);
    case 'createShipment':
      return adapter.createShipment(shipmentRequest, ctx);
    case 'cancelShipment':
      return adapter.cancelShipment(shipmentRef, ctx);
    case 'schedulePickup':
      return adapter.schedulePickup(pickupRequest, ctx);
    case 'cancelPickup':
      return adapter.cancelPickup({ confirmationNumber: 'PU1', date: '2026-11-20' }, ctx);
    case 'track':
      return adapter.track(['FAKE0001'], ctx);
    case 'validateAddress':
      return adapter.validateAddress(address, ctx);
    case 'findServicePoints':
      return adapter.findServicePoints({ address }, ctx);
    case 'uploadCustomsDocuments':
      return adapter.uploadCustomsDocuments({ ref: shipmentRef, documents: [] }, ctx);
    case 'estimateLandedCost':
      return adapter.estimateLandedCost({ rate: rateRequest, items: [] }, ctx);
    case 'recoverLabel':
      return adapter.recoverLabel(shipmentRef, ['PDF_4X6'], ctx);
  }
}

/** The adapter's `io` hook stands in for a real carrier call: it opens a socket, which the monitor counts. */
const networkCall = (): void => {
  void fetch('https://carrier.example/api');
};

let network: NetworkMonitor;
beforeEach(() => {
  network = monitorNetwork();
});
afterEach(() => {
  network.restore();
});

describe('network monitor (control)', () => {
  it('counts fetch and raw socket attempts, so a zero count below is not vacuous', () => {
    expect(() => {
      networkCall();
    }).toThrow('network access attempted');
    expect(() => new Socket().connect(443, 'carrier.example')).toThrow('network access attempted');
    expect(network.attempts()).toBe(2);
  });
});

describe('[AT-US-121-01] the adapter exposes required and optional operations with a context', () => {
  it('[AT-US-121-01] every required operation accepts a CarrierContext with accountRef, environment and correlationId', async () => {
    const seen: CarrierContext[] = [];
    const guarded = guardAdapter(createFakeAdapter({ io: (_operation, ctx) => seen.push(ctx) }));
    const ctx = fakeContext();
    for (const operation of REQUIRED_OPERATIONS) await invoke(guarded, operation, ctx);
    expect(seen).toHaveLength(REQUIRED_OPERATIONS.length);
    for (const received of seen) {
      expect(received.account).toEqual({ id: 'acct-1', code: 'FAKE_PLATFORM_SANDBOX', carrierCode: FAKE_CARRIER, environment: 'sandbox' });
      expect(received.environment).toBe('sandbox');
      expect(received.correlationId).toBe('corr-0123456789');
    }
  });

  it('[AT-US-121-01] capabilities() returns a boolean for each optional operation and for operations.cancelShipment', () => {
    const { operations } = guardAdapter(createFakeAdapter()).capabilities();
    expect(Object.keys(operations).sort()).toEqual([...DECLARED_OPERATIONS].sort());
    for (const operation of [...OPTIONAL_OPERATIONS, 'cancelShipment'] as const) expect(typeof operations[operation]).toBe('boolean');
    expect(OPTIONAL_OPERATIONS).toEqual([
      'validateAddress',
      'findServicePoints',
      'uploadCustomsDocuments',
      'estimateLandedCost',
      'recoverLabel',
    ]);
  });

  it('[AT-US-121-01] a declaration without a boolean for an optional operation or cancelShipment is refused', () => {
    for (const operation of DECLARED_OPERATIONS) {
      const operations: Record<string, unknown> = { ...ALL_SUPPORTED };
      delete operations[operation];
      const capabilities = fakeCapabilities({ operations: operations as CarrierCapabilities['operations'] });
      expect(registrationIssues(createFakeAdapter({ capabilities })).issues).toContain(`operations.${operation} must be a boolean`);
      operations[operation] = 'true';
      expect(registrationIssues(createFakeAdapter({ capabilities })).issues).toContain(`operations.${operation} must be a boolean`);
    }
  });

  it('every operation of a supporting adapter reaches the adapter once, through the guard', async () => {
    const adapter = createFakeAdapter();
    const guarded = guardAdapter(adapter);
    for (const operation of CARRIER_OPERATIONS) await invoke(guarded, operation, fakeContext());
    expect(adapter.calls).toEqual([...CARRIER_OPERATIONS]);
  });
});

describe('[AT-US-121-03] an unsupported optional operation fails without a network call', () => {
  it.each(OPTIONAL_OPERATIONS)(
    '[AT-US-121-03] %s declared false -> CAPABILITY_NOT_SUPPORTED, zero outbound requests',
    async (operation) => {
      const adapter = createFakeAdapter({ operations: { [operation]: false }, io: networkCall });
      const guarded = guardAdapter(adapter);
      const failure = invoke(guarded, operation, fakeContext());
      await expect(failure).rejects.toBeInstanceOf(CarrierError);
      await expect(failure).rejects.toMatchObject({ code: 'CAPABILITY_NOT_SUPPORTED', carrier: FAKE_CARRIER, operation });
      expect(adapter.calls).toEqual([]);
      expect(network.attempts()).toBe(0);
    },
  );

  it('[AT-US-121-03] an optional operation the adapter does not implement, declared false, is answered the same way', async () => {
    const rest = omit(createFakeAdapter({ operations: { findServicePoints: false } }), 'findServicePoints');
    const guarded = guardAdapter(rest as unknown as CarrierAdapter);
    await expect(guarded.findServicePoints({ address }, fakeContext())).rejects.toMatchObject({ code: 'CAPABILITY_NOT_SUPPORTED' });
    expect(network.attempts()).toBe(0);
  });

  it('[AT-US-121-03] property: for any declaration, exactly the operations declared false are refused with no I/O', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record(Object.fromEntries(DECLARED_OPERATIONS.map((operation) => [operation, fc.boolean()]))),
        async (declared) => {
          const operations = declared as Record<(typeof DECLARED_OPERATIONS)[number], boolean>;
          const adapter = createFakeAdapter({ operations });
          const guarded = guardAdapter(adapter);
          for (const operation of CARRIER_OPERATIONS) {
            const outcome = await invoke(guarded, operation, fakeContext()).then(
              () => 'ok',
              (error: unknown) => (error instanceof CarrierError ? error.code : 'other'),
            );
            const supported =
              !(DECLARED_OPERATIONS as readonly string[]).includes(operation) || operations[operation as keyof typeof operations];
            expect(outcome).toBe(supported ? 'ok' : 'CAPABILITY_NOT_SUPPORTED');
          }
          const expectedCalls = CARRIER_OPERATIONS.filter(
            (operation) =>
              !(DECLARED_OPERATIONS as readonly string[]).includes(operation) || operations[operation as keyof typeof operations],
          );
          expect(adapter.calls).toEqual(expectedCalls);
        },
      ),
      { numRuns: 64 },
    );
    expect(network.attempts()).toBe(0);
  });
});

describe('[AT-US-121-07] a required operation declared unsupported fails without a network call', () => {
  it('[AT-US-121-07] cancelShipment with operations.cancelShipment=false -> CAPABILITY_NOT_SUPPORTED, zero outbound requests (cancel-capability-not-supported-no-io)', async () => {
    const adapter = createFakeAdapter({ operations: { cancelShipment: false }, io: networkCall });
    const guarded = guardAdapter(adapter);
    const failure = guarded.cancelShipment(shipmentRef, fakeContext());
    await expect(failure).rejects.toMatchObject({ code: 'CAPABILITY_NOT_SUPPORTED', operation: 'cancelShipment' });
    expect(adapter.calls).toEqual([]);
    expect(network.attempts()).toBe(0);
  });

  it('[AT-US-121-07] the other required operations of that adapter still reach it', async () => {
    const adapter = createFakeAdapter({ operations: { cancelShipment: false } });
    const guarded = guardAdapter(adapter);
    await guarded.cancelPickup({ confirmationNumber: 'PU1', date: '2026-11-20' }, fakeContext());
    expect(adapter.calls).toEqual(['cancelPickup']);
  });
});

describe('[AT-US-121-06] an adapter missing a required operation is rejected at registration', () => {
  it('[AT-US-121-06] an adapter without track fails registration with a message naming track', () => {
    const withoutTrack = omit(createFakeAdapter(), 'track');
    expect(() => createCarrierRegistry([withoutTrack as unknown as CarrierAdapter])).toThrow(/missing required operation track/u);
    try {
      createCarrierRegistry([withoutTrack as unknown as CarrierAdapter]);
    } catch (error) {
      expect(error).toBeInstanceOf(CarrierContractError);
      expect((error as CarrierContractError).message).toContain(`carrier adapter ${FAKE_CARRIER} cannot be registered`);
    }
  });

  it.each(REQUIRED_OPERATIONS)('[AT-US-121-06] missing %s is named', (operation) => {
    const adapter: Record<string, unknown> = { ...createFakeAdapter() };
    delete adapter[operation];
    expect(registrationIssues(adapter).issues).toEqual([`missing required operation ${operation}`]);
  });

  it('[AT-US-121-06] several missing operations are all named in one error', () => {
    const adapter: Record<string, unknown> = { ...createFakeAdapter() };
    delete adapter.track;
    delete adapter.getRates;
    expect(() => guardAdapter(adapter as unknown as CarrierAdapter)).toThrow(
      /missing required operation getRates; missing required operation track/u,
    );
  });

  it('an operation declared supported without an implementation is refused', () => {
    const adapter = omit(createFakeAdapter(), 'recoverLabel');
    expect(registrationIssues(adapter).issues).toEqual(['operations.recoverLabel is declared true but the adapter has no recoverLabel']);
  });

  it('a missing or throwing capabilities() is refused', () => {
    const noCapabilities = omit(createFakeAdapter(), 'capabilities');
    expect(registrationIssues(noCapabilities).issues).toEqual(['missing required operation capabilities']);
    const throwing = {
      ...createFakeAdapter(),
      capabilities: () => {
        throw new Error('boom');
      },
    };
    expect(registrationIssues(throwing).issues).toEqual(['capabilities() threw']);
  });

  it('an invalid code, a non-object and a malformed declaration are refused', () => {
    expect(registrationIssues(null).issues).toEqual(['adapter must be an object']);
    expect(registrationIssues({ ...createFakeAdapter(), code: 'fake' }).issues).toContain('code must match ^[A-Z][A-Z0-9_]{1,31}$');
    expect(registrationIssues(createFakeAdapter({ capabilities: fakeCapabilities({ maxTrackingNumbersPerCall: 0 }) })).issues).toEqual([
      'maxTrackingNumbersPerCall must be an integer 1..1000',
    ]);
    expect(() => guardAdapter({ ...createFakeAdapter(), code: 7 } as unknown as CarrierAdapter)).toThrow('carrier adapter (no code)');
  });
});

describe('guarded facade', () => {
  it('capabilities() is the deep-frozen registration snapshot; later changes of the adapter do not move the guard', async () => {
    let declared = fakeCapabilities();
    const adapter = { ...createFakeAdapter(), capabilities: () => declared };
    const guarded = guardAdapter(adapter);
    declared = fakeCapabilities({ operations: { ...ALL_SUPPORTED, cancelShipment: false } });
    expect(guarded.capabilities().operations.cancelShipment).toBe(true);
    expect(Object.isFrozen(guarded.capabilities().services[0]?.directions)).toBe(true);
    expect(Object.isFrozen(guarded)).toBe(true);
    await expect(guarded.cancelShipment(shipmentRef, fakeContext())).resolves.toEqual({ cancelled: true });
  });

  it('a context of another carrier, or with an environment that differs from its account, is refused before the adapter', async () => {
    const adapter = createFakeAdapter({ io: networkCall });
    const guarded = guardAdapter(adapter);
    await expect(guarded.getRates(rateRequest, fakeContext({ carrierCode: 'OTHER' }))).rejects.toThrow(
      `context account belongs to carrier OTHER, not ${FAKE_CARRIER}`,
    );
    const split = { ...fakeContext(), environment: 'production' } as CarrierContext;
    await expect(guarded.track(['FAKE0001'], split)).rejects.toThrow('context environment differs from the account environment');
    await expect(guarded.track(['FAKE0001'], { ...fakeContext(), correlationId: 'x' })).rejects.toBeInstanceOf(CarrierContractError);
    await expect(guarded.track(['FAKE0001'], null as unknown as CarrierContext)).rejects.toThrow('context must be an object');
    expect(adapter.calls).toEqual([]);
    expect(network.attempts()).toBe(0);
  });

  it('an adapter failure propagates unchanged', async () => {
    const failure = new CarrierError('TIMEOUT', { carrier: FAKE_CARRIER, operation: 'getRates' });
    const adapter = { ...createFakeAdapter(), getRates: () => Promise.reject(failure) };
    await expect(guardAdapter(adapter).getRates(rateRequest, fakeContext())).rejects.toBe(failure);
  });
});

describe('registry', () => {
  it('registers adapters by code and hands out the guarded facade', () => {
    const registry = createCarrierRegistry([createFakeAdapter(), createFakeAdapter({ code: 'SECOND' })]);
    expect(registry.codes).toEqual([FAKE_CARRIER, 'SECOND']);
    expect(registry.has('SECOND')).toBe(true);
    expect(registry.has('MISSING')).toBe(false);
    expect(Object.isFrozen(registry.get(FAKE_CARRIER))).toBe(true);
    expect(() => registry.get('MISSING')).toThrow('no adapter is registered for MISSING');
  });

  it('a duplicate code and every defective adapter are reported together; nothing is registered', () => {
    const broken = omit(createFakeAdapter({ code: 'BROKEN' }), 'track');
    expect(() => createCarrierRegistry([createFakeAdapter(), createFakeAdapter(), broken as unknown as CarrierAdapter])).toThrow(
      /carrier FAKE_CARRIER is registered twice; carrier adapter BROKEN cannot be registered: missing required operation track/u,
    );
  });

  it('an unexpected error during registration is not swallowed', () => {
    const hostile = new Proxy(createFakeAdapter(), {
      get: (target, key) => {
        if (key === 'code') throw new TypeError('hostile');
        return Reflect.get(target, key) as unknown;
      },
    });
    expect(() => createCarrierRegistry([hostile])).toThrow(TypeError);
  });
});
