/**
 * SPK-04 (TASK-018) THROWAWAY: pure verdict logic of the audit A/B benchmark (unit-tested, no I/O).
 *
 * Lifecycle (D-ARCH-089, SPK-04 §8): deleted by the TASK-280 PR, after the validity rule and the verdict are ported to
 * tests/load/lib. Harness-only: nothing under apps/** or packages/** may import this file.
 *
 * Budgets: NFR-AUDIT-005 (audit overhead <= 15 ms p95 and <= 40 ms p99 versus the same route with audit disabled).
 * Validity (TEST-STRATEGY §7.10): an arm is INCONCLUSIVE when k6 dropped more than 1 % of the scheduled iterations or
 * the host CPU was above 85 % busy for more than 10 % of the 1 s samples.
 * Verdict vocabulary of this tool (four values, plus a fail-closed fifth): `on` meets both budgets => GO; else
 * `batched` meets them => FALLBACK (the multi-row variant is the candidate for TASK-030); else FALLBACK-INSUFFICIENT;
 * any invalid arm => INCONCLUSIVE (no exit is demonstrated). INTEGRITY_FAILED overrides all four when the post-run
 * integrity step throws or any check is not ok (code review R1-m4). The pooling below (mean of the per-repetition
 * deltas) cannot resolve a 15 ms budget with n = 2 on a noisy host (R1-m1); TASK-280 needs at least 5 repetitions in
 * a randomised or balanced order and a per-repetition rule (D-ARCH-088), so do not copy the pooling.
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

export type FinalVerdict = Verdict | 'INTEGRITY_FAILED';

/** The post-run integrity checks the runner must report; a missing one counts as a failure. */
export const INTEGRITY_CHECKS = ['chain', 'immutability', 'triggers', 'rls', 'partitions'] as const;

/**
 * Fail-closed reading of the integrity result (code review R1-m4): an `error` entry (the step threw), a missing check
 * or a check whose `ok` is not exactly `true` is a failure. An empty list means every check passed.
 */
export function integrityFailures(result: Readonly<Record<string, unknown>>): string[] {
  const failures: string[] = [];
  if ('error' in result) failures.push(`integrity step threw: ${String(result['error'])}`);
  for (const check of INTEGRITY_CHECKS) {
    const entry = result[check];
    const ok = typeof entry === 'object' && entry !== null ? (entry as { ok?: unknown }).ok : undefined;
    if (ok !== true) failures.push(`${check}: ${ok === undefined ? 'missing' : 'not ok'}`);
  }
  return failures;
}

/** A run is only as good as its integrity: any failure turns the verdict into INTEGRITY_FAILED. */
export function finalVerdict(decision: Decision, integrity: Readonly<Record<string, unknown>>): FinalVerdict {
  return integrityFailures(integrity).length > 0 ? 'INTEGRITY_FAILED' : decision.verdict;
}
