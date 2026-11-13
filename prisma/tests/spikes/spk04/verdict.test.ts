import { describe, expect, it } from '@jest/globals';

import {
  type ArmMeasurement,
  busyShare,
  decide,
  delta,
  finalVerdict,
  INTEGRITY_CHECKS,
  integrityFailures,
  meetsBudget,
  percentile,
  pooled,
  type Repetition,
  validity,
} from './verdict.js';

const arm = (p95: number, p99: number, overrides: Partial<ArmMeasurement> = {}): ArmMeasurement => ({
  latency: { p50: p95 / 2, p95, p99 },
  droppedRatio: 0,
  cpuBusy: [50, 60, 70],
  ...overrides,
});

const rep = (on: [number, number], batched: [number, number], off: ArmMeasurement = arm(100, 200)): Repetition => ({
  off,
  on: arm(off.latency.p95 + on[0], off.latency.p99 + on[1]),
  batched: arm(off.latency.p95 + batched[0], off.latency.p99 + batched[1]),
});

describe('SPK-04 verdict', () => {
  it('percentile is nearest-rank', () => {
    const samples = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(percentile(samples, 50)).toBe(50);
    expect(percentile(samples, 95)).toBe(95);
    expect(percentile(samples, 99)).toBe(99);
    expect(percentile(samples, 100)).toBe(100);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBeNaN();
  });

  it('budget boundaries: exactly 15 ms p95 and 40 ms p99 pass; anything above fails', () => {
    expect(meetsBudget({ p50: 0, p95: 15, p99: 40 })).toBe(true);
    expect(meetsBudget({ p50: 0, p95: 15.001, p99: 40 })).toBe(false);
    expect(meetsBudget({ p50: 0, p95: 15, p99: 40.001 })).toBe(false);
    expect(meetsBudget({ p50: 0, p95: -3, p99: -1 })).toBe(true);
  });

  it('dropped iterations: exactly 1 % is valid, above is INCONCLUSIVE', () => {
    expect(validity(arm(1, 1, { droppedRatio: 0.01 })).valid).toBe(true);
    const over = validity(arm(1, 1, { droppedRatio: 0.0101 }));
    expect(over.valid).toBe(false);
    expect(over.reasons[0]).toMatch(/dropped_iterations/);
  });

  it('host CPU: > 85 % in exactly 10 % of samples is valid, more is INCONCLUSIVE; 85 % itself is not busy', () => {
    const ten = [86, ...Array.from({ length: 9 }, () => 85)];
    expect(busyShare(ten)).toBeCloseTo(0.1);
    expect(validity(arm(1, 1, { cpuBusy: ten })).valid).toBe(true);
    const eleven = [86, 90, ...Array.from({ length: 8 }, () => 10)];
    expect(validity(arm(1, 1, { cpuBusy: eleven })).valid).toBe(false);
    expect(busyShare([])).toBe(0);
  });

  it('delta and pooled delta (mean of repetitions)', () => {
    expect(delta({ p50: 5, p95: 30, p99: 60 }, { p50: 2, p95: 10, p99: 20 })).toEqual({ p50: 3, p95: 20, p99: 40 });
    expect(
      pooled([
        { p50: 1, p95: 10, p99: 30 },
        { p50: 3, p95: 20, p99: 50 },
      ]),
    ).toEqual({ p50: 2, p95: 15, p99: 40 });
    expect(() => pooled([])).toThrow(RangeError);
  });

  it('GO when `on` meets both budgets (boundary inclusive)', () => {
    expect(decide([rep([15, 40], [5, 5]), rep([15, 40], [5, 5])]).verdict).toBe('GO');
    expect(decide([rep([10, 30], [50, 90])]).verdict).toBe('GO');
  });

  it('FALLBACK when `on` misses either budget but `batched` meets both', () => {
    expect(decide([rep([16, 30], [9, 20])]).verdict).toBe('FALLBACK');
    expect(decide([rep([10, 41], [9, 40])]).verdict).toBe('FALLBACK');
  });

  it('FALLBACK-INSUFFICIENT when neither meets the budgets', () => {
    expect(decide([rep([30, 80], [20, 50])]).verdict).toBe('FALLBACK-INSUFFICIENT');
  });

  it('pools across repetitions: one bad repetition can be outweighed, and is reported', () => {
    const decision = decide([rep([20, 30], [5, 5]), rep([8, 30], [5, 5])]);
    expect(decision.onDelta.p95).toBe(14);
    expect(decision.verdict).toBe('GO');
  });

  it('INCONCLUSIVE when any arm of any repetition is invalid, whatever the deltas', () => {
    const bad = arm(100, 200, { droppedRatio: 0.02 });
    const decision = decide([rep([1, 1], [1, 1]), rep([1, 1], [1, 1], bad)]);
    expect(decision.verdict).toBe('INCONCLUSIVE');
    expect(decision.invalid).toEqual(['rep 2 off: dropped_iterations 2.00 % > 1 %']);
  });
});

describe('SPK-04 integrity fails closed (R1-m4)', () => {
  const passing = Object.fromEntries(INTEGRITY_CHECKS.map((check) => [check, { ok: true }]));
  const decision = decide([rep([5, 10], [5, 10])]);

  it('passes only when every check is ok', () => {
    expect(integrityFailures(passing)).toEqual([]);
    expect(finalVerdict(decision, passing)).toBe('GO');
  });

  it('a thrown integrity step is a failure, not a status', () => {
    const result = { error: 'connection refused' };
    expect(integrityFailures(result)[0]).toContain('integrity step threw: connection refused');
    expect(finalVerdict(decision, result)).toBe('INTEGRITY_FAILED');
  });

  it('a check that is not ok, or is missing, is a failure', () => {
    expect(integrityFailures({ ...passing, chain: { ok: false } })).toEqual(['chain: not ok']);
    const rest = Object.fromEntries(Object.entries(passing).filter(([check]) => check !== 'partitions'));
    expect(integrityFailures(rest)).toEqual(['partitions: missing']);
    expect(integrityFailures({ ...passing, rls: { ok: 'yes' } })).toEqual(['rls: not ok']);
    expect(finalVerdict(decide([rep([50, 100], [50, 100])]), { ...passing, chain: { ok: false } })).toBe('INTEGRITY_FAILED');
  });

  it('keeps an INCONCLUSIVE decision when the integrity passes', () => {
    const invalid = decide([{ ...rep([5, 10], [5, 10]), on: arm(100, 200, { droppedRatio: 0.05 }) }]);
    expect(finalVerdict(invalid, passing)).toBe('INCONCLUSIVE');
  });
});
