/**
 * Baseline tracking of the Mock carrier (AT-US-122-03, REQ-TRACK-001): the happy path of the canonical taxonomy for a
 * number the Mock issued. Event times are offsets from a fixed anchor, never from a clock, so the answer is the same on
 * every call; the scenario variants (`track=customs_hold`, ...) are TASK-097's. Locations are city level at most and
 * descriptions are generic, so nothing personal is ever produced.
 */
import type { TrackingStatus } from '../../canonical/codes.js';
import type { TrackingEvent } from '../../canonical/types.js';

/** Default anchor of the baseline event times (a Monday, 09:00 UTC). */
export const DEFAULT_TRACKING_START = '2026-01-05T09:00:00.000Z';

const HOUR_MS = 3_600_000;

interface BaselineStep {
  readonly status: TrackingStatus;
  readonly afterHours: number;
  readonly city: string;
  readonly description: string;
}

const HAPPY_PATH: readonly BaselineStep[] = [
  { status: 'INFO_RECEIVED', afterHours: 0, city: 'Mock Origin City', description: 'Shipment information received' },
  { status: 'PICKED_UP', afterHours: 6, city: 'Mock Origin City', description: 'Picked up' },
  { status: 'IN_TRANSIT', afterHours: 30, city: 'Mock Gateway City', description: 'In transit' },
  { status: 'OUT_FOR_DELIVERY', afterHours: 72, city: 'Mock Destination City', description: 'Out for delivery' },
  { status: 'DELIVERED', afterHours: 80, city: 'Mock Destination City', description: 'Delivered' },
];

/** The happy-path events of `trackingNumber`, oldest first, starting at `start` (an ISO instant). */
export function baselineEvents(trackingNumber: string, start: string): TrackingEvent[] {
  const anchor = Date.parse(start);
  return HAPPY_PATH.map((step, index) => ({
    status: step.status,
    unmapped: false,
    occurredAt: new Date(anchor + step.afterHours * HOUR_MS).toISOString(),
    city: step.city,
    carrierEventCode: `MOCK_${String(index + 1).padStart(2, '0')}`,
    carrierEventId: `${trackingNumber}-${String(index + 1)}`,
    carrierDescription: step.description,
  }));
}
