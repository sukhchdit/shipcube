/**
 * `audit_chain` readiness check (US-012 part, REQ-AUDIT-013; PR #9 code review m2 / D-TASK006-02, D-ARCH-074;
 * TASK-021). Replaces the `pendingCheck('audit_chain')` stub.
 *
 * `ok` when the latest FINISHED `audit_chain_verifications` run passed; `degraded` while no verification has finished
 * yet (the hourly verifier is TASK-116) and when the latest finished run is `FAILED` or `ERROR` (the verifier raises
 * its own security events, ADR-0007 am. 7 item 6). A `RUNNING` row is not a result and is skipped. Never critical:
 * the audit chain degrades readiness, it does not take the process out of rotation (AT-US-012-04).
 */
import type { CheckOutcome, ReadinessCheck } from '../../runtime/readiness.js';
import { AUDIT_READINESS_INTERVAL_MS, type CatalogReader, intervalCache } from './catalog-reader.js';

/** Latest finished verification run (bounded: one row). Operators and types qualified, as in audit-partitions.ts (PR24-SEC-02). */
export const LATEST_VERIFICATION_SQL = `SELECT v.status AS status
  FROM public.audit_chain_verifications v
 WHERE v.status OPERATOR(pg_catalog.<>) 'RUNNING'::pg_catalog.text
 ORDER BY v.started_at DESC, v.id DESC
 LIMIT 1`;

export type ChainStatus = 'ok' | 'degraded';

/** Pure: the component status for the latest finished run's `status` (`undefined` = no run yet). */
export function chainStatus(latest: string | undefined): ChainStatus {
  return latest === 'PASSED' ? 'ok' : 'degraded';
}

const statusOf = (rows: readonly unknown[]): string | undefined => {
  const first: unknown = rows[0];
  if (first === undefined) return undefined;
  if (typeof first !== 'object' || first === null) throw new TypeError('unexpected audit chain verification row shape');
  const status = (first as Record<string, unknown>)['status'];
  if (typeof status !== 'string') throw new TypeError('unexpected audit chain verification row shape');
  return status;
};

export interface AuditChainCheckOptions {
  readonly now?: () => number;
  readonly intervalMs?: number;
}

/** The `audit_chain` component (degradable; a query failure also degrades). */
export function createAuditChainCheck(reader: CatalogReader, options: AuditChainCheckOptions = {}): ReadinessCheck {
  const cache = intervalCache<ChainStatus>(options.intervalMs ?? AUDIT_READINESS_INTERVAL_MS, options.now ?? Date.now);
  const load = async (): Promise<ChainStatus> => chainStatus(statusOf((await reader.query(LATEST_VERIFICATION_SQL)).rows));
  return Object.freeze({
    name: 'audit_chain' as const,
    critical: false,
    async check(signal: AbortSignal): Promise<CheckOutcome> {
      signal.throwIfAborted();
      return (await cache.get(load)) === 'ok' ? undefined : 'degraded';
    },
  });
}
