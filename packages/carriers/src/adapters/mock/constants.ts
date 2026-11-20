/**
 * Fixed facts of the deterministic Mock carrier (REQ-CARR-004, US-122, ADR-0010 §Mock carrier). Everything the Mock
 * answers is a pure function of the request and these tables: no clock, no random source, no shared state.
 */
import type { ServiceTier } from '../../canonical/codes.js';

export const MOCK_CARRIER_CODE = 'MOCK';
export const MOCK_CURRENCY = 'USD';

/** Mock carrier service codes (canonical `MOCK_<code>`, DR-B30). */
export const MOCK_SERVICE_CODES = ['EXPRESS', 'STANDARD', 'ECONOMY'] as const;
export type MockServiceCode = (typeof MOCK_SERVICE_CODES)[number];

export interface MockServiceSpec {
  readonly tier: ServiceTier;
  /** Flat fee in USD minor units. */
  readonly baseMinor: number;
  /** Multiplier on the per-step zone rate, in permille. */
  readonly stepPermille: number;
  readonly transitDaysMin: number;
  readonly transitDaysMax: number;
}

/** US-122 notes: EXPRESS 1-3, STANDARD 3-5, ECONOMY 5-9 transit days. */
export const MOCK_SERVICES: Readonly<Record<MockServiceCode, MockServiceSpec>> = Object.freeze({
  EXPRESS: { tier: 'EXPRESS', baseMinor: 2500, stepPermille: 1800, transitDaysMin: 1, transitDaysMax: 3 },
  STANDARD: { tier: 'STANDARD', baseMinor: 1500, stepPermille: 1000, transitDaysMin: 3, transitDaysMax: 5 },
  ECONOMY: { tier: 'ECONOMY', baseMinor: 900, stepPermille: 650, transitDaysMin: 5, transitDaysMax: 9 },
});

export type MockZone = 1 | 2 | 3 | 4;

/** Price per billable step of 500 g by lane zone (1 domestic .. 4 far), USD minor units, STANDARD multiplier. */
export const ZONE_STEP_MINOR: Readonly<Record<MockZone, number>> = Object.freeze({ 1: 150, 2: 250, 3: 450, 4: 700 });

/** Billable weight is rounded up to this step. */
export const BILLABLE_STEP_G = 500;
/** Volumetric divisor, metric: 5000 cm³ per kg, which is mm³ / 5000 in grams. */
export const VOLUMETRIC_DIVISOR_MM3_PER_G = 5000;
/** Fuel surcharge, percent of the base charge. */
export const FUEL_SURCHARGE_PERCENT = 12;

/** Mock limits: a request beyond them returns no service (US-122 scenario 6). */
export const MAX_PACKAGE_WEIGHT_G = 70_000;
export const MAX_SHIPMENT_WEIGHT_G = 300_000;
export const MAX_DIMENSIONS_MM = Object.freeze({ lengthMm: 1200, widthMm: 800, heightMm: 800 });
export const MAX_TRACKING_NUMBERS = 30;

/** Pickup window the Mock serves (ISO weekdays Monday to Friday). */
export const PICKUP_DAYS: readonly number[] = Object.freeze([1, 2, 3, 4, 5]);
export const PICKUP_EARLIEST_READY = '08:00';
export const PICKUP_LATEST_CLOSE = '18:00';
export const PICKUP_MIN_WINDOW_MINUTES = 120;

/** Bound of the in-memory call record list. */
export const DEFAULT_MAX_CALL_RECORDS = 1000;
