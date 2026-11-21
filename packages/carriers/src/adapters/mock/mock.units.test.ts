/** Unit tests of the pure parts of the Mock carrier: zones, rating, derived identifiers, scenario parsing, exports. */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { isCarrierCode } from '../../canonical/codes.js';
import * as barrel from '../../index.js';
import { MOCK_SERVICE_CODES, type MockZone } from './constants.js';
import { isMockPickupConfirmation, isMockTrackingNumber, pickupConfirmationFor, trackingNumberFor } from './derive.js';
import * as mockModule from './index.js';
import { billableWeightG, estimatedDelivery, priceService } from './rates.js';
import { MAX_LATENCY_MS, parseLatencyMs } from './scenario.js';
import { laneZone } from './zones.js';

describe('lane zones', () => {
  it.each([
    ['US', 'US', 1],
    ['US', 'CA', 2],
    ['IN', 'PK', 2],
    ['US', 'BR', 3],
    ['IN', 'CN', 3],
    ['US', 'IN', 4],
    ['US', 'AU', 4],
    ['US', 'ZZ', 4],
    ['ZZ', 'ZZ', 1],
    ['ZZ', 'YY', 4],
  ] as const)('%s to %s is zone %i, and the lane is symmetric', (from, to, zone) => {
    expect(laneZone(from, to)).toBe(zone);
    expect(laneZone(to, from)).toBe(zone);
  });
});

describe('rating', () => {
  const box = { packageType: 'PARCEL_BOX' as const, weightG: 2000, lengthMm: 300, widthMm: 200, heightMm: 100 };

  it('billable weight is the larger of actual and volumetric, summed and rounded up to 500 g', () => {
    expect(billableWeightG([box])).toBe(2000);
    expect(billableWeightG([{ ...box, weightG: 100 }])).toBe(1500); // volumetric 1200 g
    expect(billableWeightG([{ ...box, weightG: 2001 }])).toBe(2500);
    expect(billableWeightG([box, box])).toBe(4000);
    expect(billableWeightG([{ ...box, weightG: 1, lengthMm: 1, widthMm: 1, heightMm: 1 }])).toBe(500);
  });

  it('prices on integer minor units: flat fee plus per-step zone rate plus half-up fuel', () => {
    // STANDARD zone 4, 2 kg: base 1500 + 4 * 700 = 4300; fuel 12 % = 516
    expect(priceService('STANDARD', 4, 2000)).toMatchObject({ base: { amount: 4300 }, fuel: { amount: 516 }, total: { amount: 4816 } });
    // EXPRESS zone 1, 500 g: step round(150 * 1800 / 1000) = 270; base 2770; fuel 332.4 -> 332
    expect(priceService('EXPRESS', 1, 500)).toMatchObject({ base: { amount: 2770 }, fuel: { amount: 332 }, total: { amount: 3102 } });
  });

  it('property: the price is an integer, non-decreasing in weight and in zone, and dearer for faster services', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 600 }),
        fc.integer({ min: 0, max: 50 }),
        fc.constantFrom<MockZone[]>(1, 2, 3, 4),
        (steps, more, zone) => {
          const [express, standard, economy] = MOCK_SERVICE_CODES.map((service) => priceService(service, zone, steps * 500));
          expect(Number.isSafeInteger(express?.total.amount)).toBe(true);
          expect(express?.total.amount).toBeGreaterThan(standard?.total.amount ?? Infinity);
          expect(standard?.total.amount).toBeGreaterThan(economy?.total.amount ?? Infinity);
          for (const service of MOCK_SERVICE_CODES) {
            expect(priceService(service, zone, (steps + more) * 500).total.amount).toBeGreaterThanOrEqual(
              priceService(service, zone, steps * 500).total.amount,
            );
          }
          if (zone < 4)
            expect(priceService('STANDARD', (zone + 1) as MockZone, steps * 500).total.amount).toBeGreaterThan(
              standard?.total.amount ?? Infinity,
            );
        },
      ),
    );
  });

  it('derives the estimated delivery from the ship date only', () => {
    expect(estimatedDelivery('2026-12-30', 3)).toBe('2027-01-02T00:00:00.000Z');
    expect(estimatedDelivery('2026-12-30', 3)).toBe(estimatedDelivery('2026-12-30', 3));
    expect(estimatedDelivery('30/12/2026', 3)).toBeUndefined();
    expect(estimatedDelivery('2026-13-45', 3)).toBeUndefined();
  });
});

describe('derived identifiers', () => {
  it('tracking numbers are MOCK plus 12 digits, stable, and distinct per package position', () => {
    expect(trackingNumberFor('SHP-123-A1')).toMatch(/^MOCK\d{12}$/u);
    expect(trackingNumberFor('SHP-123-A1')).toBe(trackingNumberFor('SHP-123-A1'));
    expect(trackingNumberFor('SHP-123-A1', 1)).toBe(trackingNumberFor('SHP-123-A1'));
    expect(trackingNumberFor('SHP-123-A1', 2)).not.toBe(trackingNumberFor('SHP-123-A1'));
  });

  it('recognises only the numbers it issues', () => {
    expect(isMockTrackingNumber('MOCK000000000001')).toBe(true);
    for (const value of ['MOCK00000000001', 'MOCK0000000000011', 'mock000000000001', '1Z999AA10123456784', 12, undefined]) {
      expect(isMockTrackingNumber(value)).toBe(false);
    }
    expect(isMockPickupConfirmation(pickupConfirmationFor(['2026-12-01', '09:00']))).toBe(true);
    expect(isMockPickupConfirmation('MOCKPU123')).toBe(false);
    expect(isMockPickupConfirmation(undefined)).toBe(false);
  });
});

describe('scenario latency directive', () => {
  it.each([
    ['latency=6000', 6000],
    ['latency=0', 0],
    [' fail=rates ; latency=250 ', 250],
    ['latency=30000', MAX_LATENCY_MS],
    ['latency=30001', 0],
    ['latency=1e3', 0],
    ['latency=', 0],
    ['LATENCY=5', 0],
    ['', 0],
    [undefined, 0],
  ] as const)('%s -> %i ms', (raw, expected) => {
    expect(parseLatencyMs(raw)).toBe(expected);
  });
});

describe('package surface (PR076-SEC-06, D-SECPR076-01)', () => {
  it('[PR076-SEC-06] adds no subpath export: the exports map still holds the `.` entry only', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(manifest.exports)).toEqual(['.']);
  });

  it('exposes the factory and constants through the package barrel, and nothing else of the Mock folder', () => {
    expect(Object.keys(mockModule).sort()).toEqual(
      [
        'MAX_LATENCY_MS',
        'MOCK_CARRIER_CODE',
        'MOCK_CURRENCY',
        'MOCK_EGRESS',
        'MOCK_LABEL_MARKER',
        'MOCK_SERVICE_CODES',
        'createMockAdapter',
        'mockCapabilities',
        'mockLabel',
        'parseLatencyMs',
      ].sort(),
    );
    expect(barrel.createMockAdapter).toBe(mockModule.createMockAdapter);
    expect(isCarrierCode(barrel.MOCK_CARRIER_CODE)).toBe(true);
  });
});
