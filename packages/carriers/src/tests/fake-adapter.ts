/**
 * Test doubles of the carrier contract (test-only; `src/tests/**` is a test folder for lint and coverage). A fake
 * adapter whose every operation records the call and runs an injectable `io` hook, so a test can prove the capability
 * guard never reached the adapter; and a complete, valid capability declaration to mutate.
 */
import { zero } from '@platform/shared';

import type { CarrierAdapter } from '../adapter.js';
import type { CarrierCapabilities, OperationSupport, ServiceCapability } from '../capabilities.js';
import { type CarrierContext, createCarrierContext } from '../context.js';
import type { CarrierOperation } from '../operations.js';
import { type CarrierRegistry, createCarrierRegistry } from '../registry.js';

/** A logger that discards lines, for tests that do not inspect them. */
export const SILENT_LOGGER = { warn: (): void => undefined };

/** `createCarrierRegistry` with the silent logger. */
export const registryOf = (adapters: Iterable<CarrierAdapter>): CarrierRegistry =>
  createCarrierRegistry(adapters, { logger: SILENT_LOGGER });

export const FAKE_CARRIER = 'FAKE_CARRIER';

export const ALL_SUPPORTED: OperationSupport = {
  validateAddress: true,
  findServicePoints: true,
  uploadCustomsDocuments: true,
  estimateLandedCost: true,
  recoverLabel: true,
  cancelShipment: true,
};

export function fakeService(
  carrierServiceCode = 'EXPRESS',
  overrides: Partial<ServiceCapability> = {},
  carrierCode = FAKE_CARRIER,
): ServiceCapability {
  return {
    canonicalCode: `${carrierCode}_${carrierServiceCode}`,
    carrierServiceCode,
    tier: 'EXPRESS',
    directions: ['EXPORT', 'IMPORT', 'DOMESTIC'],
    contentTypes: ['DOCUMENT', 'PARCEL'],
    maxPackageWeightG: 70_000,
    maxShipmentWeightG: 300_000,
    maxDimensionsMm: { lengthMm: 1200, widthMm: 800, heightMm: 800 },
    volumetricDivisor: { metric: 5000, imperial: 139 },
    bookingCutoff: { localTime: '17:00', timeZone: 'America/New_York' },
    dropoff: true,
    pickup: true,
    ddp: true,
    paperless: true,
    labelFormats: ['PDF_4X6', 'PDF_LETTER'],
    ...overrides,
  };
}

export function fakeCapabilities(overrides: Partial<CarrierCapabilities> = {}, carrierCode = FAKE_CARRIER): CarrierCapabilities {
  return {
    operations: ALL_SUPPORTED,
    services: [fakeService('EXPRESS', {}, carrierCode), fakeService('ECONOMY', { tier: 'ECONOMY' }, carrierCode)],
    maxTrackingNumbersPerCall: 30,
    pushTracking: false,
    idempotentCreate: true,
    pickup: { daysServed: [1, 2, 3, 4, 5], earliestReady: '08:00', latestClose: '18:00', minWindowMinutes: 120 },
    ...overrides,
  };
}

export interface FakeAdapterOptions {
  readonly code?: string;
  readonly operations?: Partial<OperationSupport>;
  readonly capabilities?: CarrierCapabilities;
  /** Runs inside every operation before it answers (a network call in a real adapter). */
  readonly io?: (operation: CarrierOperation, ctx: CarrierContext) => void;
}

export interface FakeAdapter extends Required<CarrierAdapter> {
  readonly calls: CarrierOperation[];
}

/** An adapter implementing every operation (optional ones included); support is decided by `operations`. */
export function createFakeAdapter(options: FakeAdapterOptions = {}): FakeAdapter {
  const code = options.code ?? FAKE_CARRIER;
  const capabilities = options.capabilities ?? fakeCapabilities({ operations: { ...ALL_SUPPORTED, ...options.operations } }, code);
  const calls: CarrierOperation[] = [];
  const answer = <R>(operation: CarrierOperation, ctx: CarrierContext, value: R): Promise<R> => {
    calls.push(operation);
    options.io?.(operation, ctx);
    return Promise.resolve(value);
  };
  const ref = { trackingNumber: 'FAKE0001' };
  return {
    code,
    calls,
    capabilities: () => capabilities,
    getRates: (_req, ctx) => answer('getRates', ctx, { quotes: [] }),
    createShipment: (req, ctx) => answer('createShipment', ctx, { ref, serviceCode: req.serviceCode, labels: [] }),
    cancelShipment: (_ref, ctx) => answer('cancelShipment', ctx, { cancelled: true }),
    schedulePickup: (req, ctx) =>
      answer('schedulePickup', ctx, {
        ref: { confirmationNumber: 'PU1', date: req.date },
        readyTime: req.readyTime,
        closeTime: req.closeTime,
      }),
    cancelPickup: (_ref, ctx) => answer('cancelPickup', ctx, { cancelled: true }),
    track: (numbers, ctx) =>
      answer(
        'track',
        ctx,
        numbers.map((trackingNumber) => ({ trackingNumber, found: true, events: [] })),
      ),
    validateAddress: (_address, ctx) => answer('validateAddress', ctx, { valid: true, suggestions: [] }),
    findServicePoints: (_query, ctx) => answer('findServicePoints', ctx, []),
    uploadCustomsDocuments: (_req, ctx) => answer('uploadCustomsDocuments', ctx, undefined),
    estimateLandedCost: (req, ctx) =>
      answer('estimateLandedCost', ctx, {
        duties: zero('USD'),
        taxes: zero('USD'),
        total: zero(req.items[0]?.unitValue.currency ?? 'USD'),
      }),
    recoverLabel: (_ref, _formats, ctx) => answer('recoverLabel', ctx, []),
  };
}

export function fakeContext(
  overrides: { carrierCode?: string; environment?: 'sandbox' | 'production'; correlationId?: string } = {},
): CarrierContext {
  return createCarrierContext({
    account: {
      id: 'acct-1',
      code: 'FAKE_PLATFORM_SANDBOX',
      carrierCode: overrides.carrierCode ?? FAKE_CARRIER,
      environment: overrides.environment ?? 'sandbox',
    },
    correlationId: overrides.correlationId ?? 'corr-0123456789',
    deadlineAt: new Date('2026-11-19T12:00:04Z'),
  });
}
