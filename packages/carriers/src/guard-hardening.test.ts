import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { CarrierAdapter } from './adapter.js';
import type { LabelDocument, RateRequest, ShipmentConfirmation, ShipmentRequest } from './canonical/types.js';
import type { CarrierContext } from './context.js';
import { egressBase, defineCarrierEgress } from './egress.js';
import { CarrierContractError } from './errors.js';
import { guardAdapter, LABEL_DROPPED_EVENT, registrationIssues } from './guard.js';
import type { NormaliseLogger } from './normalise/normalise.js';
import { createCarrierRegistry } from './registry.js';
import { createFakeAdapter, FAKE_CARRIER, fakeCapabilities, fakeContext, fakeService } from './tests/fake-adapter.js';
import { monitorNetwork, type NetworkMonitor } from './tests/network-monitor.js';

const EGRESS = defineCarrierEgress(FAKE_CARRIER, {
  sandbox: [{ origin: 'https://api.carrier.example', pathPrefixes: ['/v1/test/'], tier: 'sandbox' }],
  production: [{ origin: 'https://api.carrier.example', pathPrefixes: ['/v1/'], tier: 'production' }],
});
const rateRequest = {} as RateRequest;
const shipmentRequest = { serviceCode: `${FAKE_CARRIER}_EXPRESS` } as ShipmentRequest;
const pdf = new TextEncoder().encode('%PDF-1.7 synthetic');
const zpl = new TextEncoder().encode('^XA^FDSYNTHETIC^FS^XZ');
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

let network: NetworkMonitor;
beforeEach(() => {
  network = monitorNetwork();
});
afterEach(() => {
  network.restore();
});

/** An adapter that records what it sees of the context before and after an await. */
function observingAdapter(): { seen: string[]; adapter: CarrierAdapter } {
  const seen: string[] = [];
  const adapter = {
    ...createFakeAdapter(),
    getRates: async (_req: RateRequest, ctx: CarrierContext) => {
      seen.push(`${ctx.environment}/${ctx.account.environment} ${egressBase(EGRESS, ctx).pathname}`);
      await Promise.resolve();
      seen.push(`${ctx.environment}/${ctx.account.environment} ${egressBase(EGRESS, ctx).pathname}`);
      return { quotes: [] };
    },
  };
  return { seen, adapter };
}

describe('[PR075-SEC-01] the adapter receives a frozen copy of the context, never the caller object', () => {
  const sandboxOnly = ['sandbox/sandbox /v1/test/', 'sandbox/sandbox /v1/test/'];

  it('a getter that flips environment after the first read cannot move the adapter to production', async () => {
    const { seen, adapter } = observingAdapter();
    const base = fakeContext();
    let reads = 0;
    const flipping = {
      ...base,
      get environment() {
        reads += 1;
        return reads === 1 ? 'sandbox' : 'production';
      },
    } as unknown as CarrierContext;
    await guardAdapter(adapter).getRates(rateRequest, flipping);
    expect(seen).toEqual(sandboxOnly);
  });

  it('a Proxy and a mutation after the call starts cannot either', async () => {
    const { seen, adapter } = observingAdapter();
    let reads = 0;
    const proxy = new Proxy(
      { ...fakeContext() },
      {
        get: (target, key) => {
          if (key === 'environment') reads += 1;
          return key === 'environment' && reads > 1 ? 'production' : (Reflect.get(target, key) as unknown);
        },
      },
    );
    await guardAdapter(adapter).getRates(rateRequest, proxy);
    const mutable = { ...fakeContext(), account: { ...fakeContext().account } } as {
      environment: string;
      account: { environment: string };
    };
    const pending = guardAdapter(adapter).getRates(rateRequest, mutable as unknown as CarrierContext);
    mutable.environment = 'production';
    mutable.account.environment = 'production';
    await pending;
    expect(seen).toEqual([...sandboxOnly, ...sandboxOnly]);
  });

  it('the copy is frozen and equal to the validated context', async () => {
    let received: CarrierContext | undefined;
    const adapter = {
      ...createFakeAdapter(),
      track: (_numbers: readonly string[], ctx: CarrierContext) => {
        received = ctx;
        return Promise.resolve([]);
      },
    };
    const ctx = { ...fakeContext() };
    await guardAdapter(adapter).track([], ctx);
    expect(received).toEqual(ctx);
    expect(received).not.toBe(ctx);
    expect(Object.isFrozen(received)).toBe(true);
    expect(Object.isFrozen(received?.account)).toBe(true);
  });

  it('[R1-n5] a hand-built context with an invalid deadline, locale or scenario is refused before the adapter', async () => {
    const adapter = createFakeAdapter();
    const guarded = guardAdapter(adapter);
    for (const bad of [{ deadlineAt: 'never' }, { locale: 'xx\n' }, { mockScenario: 'x'.repeat(100_000) }, { account: null }]) {
      await expect(guarded.getRates(rateRequest, { ...fakeContext(), ...bad } as unknown as CarrierContext)).rejects.toBeInstanceOf(
        CarrierContractError,
      );
    }
    expect(adapter.calls).toEqual([]);
    expect(network.attempts()).toBe(0);
  });

  it('a non-contract error while reading the context is not swallowed', async () => {
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new TypeError('hostile');
        },
      },
    );
    await expect(guardAdapter(createFakeAdapter()).getRates(rateRequest, hostile as CarrierContext)).rejects.toThrow(TypeError);
  });
});

describe('[R1-m1] the declaration is cloned first and the clone is validated', () => {
  it('a function-valued field is a named issue, and the registry still reports the other adapters', () => {
    const withFunction = { ...createFakeAdapter(), capabilities: () => ({ ...fakeCapabilities(), helper: () => 1 }) };
    expect(registrationIssues(withFunction).issues).toEqual([
      'capabilities() must return plain data (it holds a function or another value that cannot be cloned)',
    ]);
    const broken = { ...createFakeAdapter({ code: 'BROKEN' }) } as Record<string, unknown>;
    delete broken.track;
    expect(() => createCarrierRegistry([withFunction, broken as unknown as CarrierAdapter])).toThrow(
      /must return plain data[\s\S]*BROKEN cannot be registered: missing required operation track/u,
    );
  });

  it('own getters are read once into the clone; inherited fields are not seen and fail closed', () => {
    const own = fakeCapabilities();
    const getterBased = Object.defineProperty({ ...own }, 'pushTracking', { get: () => false, enumerable: true });
    expect(registrationIssues({ ...createFakeAdapter(), capabilities: () => getterBased }).issues).toEqual([]);
    const inherited = Object.create({ services: own.services }) as Record<string, unknown>;
    Object.assign(inherited, { ...own, services: undefined });
    delete inherited.services;
    expect(registrationIssues({ ...createFakeAdapter(), capabilities: () => inherited }).issues).toEqual([
      'services must be a non-empty array',
    ]);
  });

  it('the guarded snapshot is the clone, not the adapter object', () => {
    const declared = fakeCapabilities();
    const guarded = guardAdapter({ ...createFakeAdapter(), capabilities: () => declared });
    expect(guarded.capabilities()).toEqual(declared);
    expect(guarded.capabilities()).not.toBe(declared);
    expect(Object.isFrozen(declared)).toBe(false);
  });
});

describe('[R1-n4] every operation is bound at registration', () => {
  it('replacing a required operation on the adapter after registration does not change the facade', async () => {
    const adapter = createFakeAdapter() as unknown as Record<string, unknown>;
    const guarded = guardAdapter(adapter as unknown as CarrierAdapter);
    adapter.track = () => Promise.reject(new Error('replaced'));
    await expect(guarded.track(['X'], fakeContext())).resolves.toEqual([{ trackingNumber: 'X', found: true, events: [] }]);
  });
});

describe('[PR075-SEC-03] labels returned by the adapter are re-checked', () => {
  const returning = (labels: unknown, recovered?: unknown): CarrierAdapter => ({
    ...createFakeAdapter(),
    createShipment: (req: ShipmentRequest) =>
      Promise.resolve({ ref: { trackingNumber: 'T1' }, serviceCode: req.serviceCode, labels } as unknown as ShipmentConfirmation),
    recoverLabel: () => Promise.resolve(recovered as LabelDocument[]),
  });

  it('createShipment keeps valid labels, drops invalid ones with one warn line each (codes only), and never throws', async () => {
    const warn = jest.fn<NormaliseLogger['warn']>();
    const adapter = returning([
      { format: 'PDF_4X6', content: pdf },
      { format: 'PNG', content: png },
      { format: 'PDF_4X6', content: png },
      { format: 'PDF_A4', url: 'https://carrier.example/label.pdf' },
      { format: 'ZPL', content: zpl },
      'junk',
      { format: 'bad\nformat', content: pdf },
    ]);
    const result = await guardAdapter(adapter, { logger: { warn } }).createShipment(shipmentRequest, fakeContext());
    expect(result.ref).toEqual({ trackingNumber: 'T1' });
    expect(result.labels.map(({ format }) => format)).toEqual(['PDF_4X6', 'ZPL']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(warn.mock.calls.map(([event, fields]) => [event, fields])).toEqual([
      [LABEL_DROPPED_EVENT, { carrier: FAKE_CARRIER, operation: 'createShipment', format: 'PNG' }],
      [LABEL_DROPPED_EVENT, { carrier: FAKE_CARRIER, operation: 'createShipment', format: 'PDF_4X6' }],
      [LABEL_DROPPED_EVENT, { carrier: FAKE_CARRIER, operation: 'createShipment', format: 'PDF_A4' }],
      [LABEL_DROPPED_EVENT, { carrier: FAKE_CARRIER, operation: 'createShipment', format: '(unprintable)' }],
      [LABEL_DROPPED_EVENT, { carrier: FAKE_CARRIER, operation: 'createShipment', format: '(unprintable)' }],
    ]);
    expect(network.attempts()).toBe(0);
  });

  it('createShipment with a non-array labels field resolves with no labels', async () => {
    const result = await guardAdapter(returning(undefined)).createShipment(shipmentRequest, fakeContext());
    expect(result.labels).toEqual([]);
  });

  it('recoverLabel refuses a raster label, an unrequested format and string content', async () => {
    const ref = { trackingNumber: 'T1' };
    await expect(
      guardAdapter(returning([], [{ format: 'GIF', content: png }])).recoverLabel(ref, ['PDF_4X6'], fakeContext()),
    ).rejects.toThrow(`${FAKE_CARRIER}.recoverLabel returned an invalid label: GIF`);
    await expect(
      guardAdapter(returning([], [{ format: 'ZPL', content: zpl }])).recoverLabel(ref, ['PDF_4X6'], fakeContext()),
    ).rejects.toThrow(CarrierContractError);
    await expect(
      guardAdapter(returning([], [{ format: 'PDF_4X6', content: 'https://carrier.example/x' }])).recoverLabel(
        ref,
        ['PDF_4X6'],
        fakeContext(),
      ),
    ).rejects.toThrow(CarrierContractError);
    await expect(
      guardAdapter(returning([], [{ format: 'PDF_4X6', content: pdf }])).recoverLabel(ref, ['PDF_4X6'], fakeContext()),
    ).resolves.toEqual([{ format: 'PDF_4X6', content: pdf }]);
  });
});

describe('registry hardening', () => {
  it('[PR075-SEC-08] get echoes only a carrier-code-shaped request', () => {
    const registry = createCarrierRegistry([createFakeAdapter()]);
    expect(() => registry.get('X\r\n{"forged":1}')).toThrow('no adapter is registered for (invalid code)');
    expect(() => registry.get('UNKNOWN')).toThrow('no adapter is registered for UNKNOWN');
  });

  it('[R1-n11] a canonical service code declared by two carriers is refused', () => {
    const first = createFakeAdapter({
      code: 'DHL',
      capabilities: fakeCapabilities({ services: [fakeService('EXPRESS_P', {}, 'DHL')] }, 'DHL'),
    });
    const second = createFakeAdapter({
      code: 'DHL_EXPRESS',
      capabilities: fakeCapabilities({ services: [fakeService('P', {}, 'DHL_EXPRESS')] }, 'DHL_EXPRESS'),
    });
    expect(() => createCarrierRegistry([first, second])).toThrow('canonical service code DHL_EXPRESS_P is declared by DHL and DHL_EXPRESS');
  });
});
