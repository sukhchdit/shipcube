/**
 * SPK-04 (TASK-018) THROWAWAY: pure verdict logic of the audit A/B benchmark (unit-tested, no I/O).
 *
 * Budgets: NFR-AUDIT-005 (audit overhead <= 15 ms p95 and <= 40 ms p99 versus the same route with audit disabled).
 * Validity (TEST-STRATEGY §7.10): an arm is INCONCLUSIVE when k6 dropped more than 1 % of the scheduled iterations or
 * the host CPU was above 85 % busy for more than 10 % of the 1 s samples.
 * Exit (SPK-04): `on` meets both budgets => GO; else `batched` meets them => FALLBACK (the multi-row variant is
 * specified for TASK-030); else FALLBACK-INSUFFICIENT (escalate to principal-architect).
 */
export const P95_BUDGET_MS = 15;
export const P99_BUDGET_MS = 40;
export const MAX_DROPPED_RATIO = 0.01;
export const CPU_BUSY_THRESHOLD = 85;
export const MAX_BUSY_SAMPLE_SHARE = 0.1;

export type Arm = 'off' | 'on' | 'batched';
export type Verdict = 'GO' | 'FALLBACK' | 'FALLBACK-INSUFFICIENT' | 'INCONCLUSIVE';

export interface Latency {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface ArmMeasurement {
  readonly latency: Latency;
  /** dropped_iterations / (iterations + dropped_iterations). */
  readonly droppedRatio: number;
  /** Host CPU % busy, one sample per second over the measured window. */
  readonly cpuBusy: readonly number[];
}

export interface Validity {
  readonly valid: boolean;
  readonly reasons: readonly string[];
  readonly busySampleShare: number;
}

export interface Delta {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

/** Nearest-rank percentile (q in [0, 100]) of unsorted samples; NaN for no samples. */
export function percentile(samples: readonly number[], q: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((q / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? Number.NaN;
}

export function busyShare(cpuBusy: readonly number[]): number {
  if (cpuBusy.length === 0) return 0;
  return cpuBusy.filter((sample) => sample > CPU_BUSY_THRESHOLD).length / cpuBusy.length;
}

export function validity(arm: ArmMeasurement): Validity {
  const reasons: string[] = [];
  const share = busyShare(arm.cpuBusy);
  if (arm.droppedRatio > MAX_DROPPED_RATIO) reasons.push(`dropped_iterations ${(arm.droppedRatio * 100).toFixed(2)} % > 1 %`);
  if (share > MAX_BUSY_SAMPLE_SHARE) reasons.push(`host CPU > 85 % in ${(share * 100).toFixed(1)} % of samples (> 10 %)`);
  return { valid: reasons.length === 0, reasons, busySampleShare: share };
}

export function delta(arm: Latency, baseline: Latency): Delta {
  return { p50: arm.p50 - baseline.p50, p95: arm.p95 - baseline.p95, p99: arm.p99 - baseline.p99 };
}

/** Mean of the per-repetition deltas (the pooled delta). */
export function pooled(deltas: readonly Delta[]): Delta {
  if (deltas.length === 0) throw new RangeError('no repetitions');
  const mean = (pick: (d: Delta) => number): number => deltas.reduce((sum, d) => sum + pick(d), 0) / deltas.length;
  return { p50: mean((d) => d.p50), p95: mean((d) => d.p95), p99: mean((d) => d.p99) };
}

export function meetsBudget(d: Delta): boolean {
  return d.p95 <= P95_BUDGET_MS && d.p99 <= P99_BUDGET_MS;
}

export interface Repetition {
  readonly off: ArmMeasurement;
  readonly on: ArmMeasurement;
  readonly batched: ArmMeasurement;
}

export interface Decision {
  readonly verdict: Verdict;
  readonly onDelta: Delta;
  readonly batchedDelta: Delta;
  readonly invalid: readonly string[];
}

/** The SPK-04 exit decision over all repetitions (pooled deltas; any invalid arm makes the run INCONCLUSIVE). */
export function decide(repetitions: readonly Repetition[]): Decision {
  const invalid: string[] = [];
  repetitions.forEach((rep, index) => {
    for (const arm of ['off', 'on', 'batched'] as const) {
      for (const reason of validity(rep[arm]).reasons) invalid.push(`rep ${String(index + 1)} ${arm}: ${reason}`);
    }
  });
  const onDelta = pooled(repetitions.map((rep) => delta(rep.on.latency, rep.off.latency)));
  const batchedDelta = pooled(repetitions.map((rep) => delta(rep.batched.latency, rep.off.latency)));
  const verdict: Verdict =
    invalid.length > 0 ? 'INCONCLUSIVE' : meetsBudget(onDelta) ? 'GO' : meetsBudget(batchedDelta) ? 'FALLBACK' : 'FALLBACK-INSUFFICIENT';
  return { verdict, onDelta, batchedDelta, invalid };
}
