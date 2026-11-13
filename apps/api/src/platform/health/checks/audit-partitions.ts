/**
 * `audit_partitions` readiness check (US-012 part, REQ-AUDIT-017; data-model §5.3 amendment 2026-11-13 item 3,
 * PR12-SEC-02, D-ARCH-076, R-ARCH-27; TASK-021).
 *
 * Contiguity is read from the CATALOGUE (`pg_class` ⋈ `pg_inherits`), never from the `audit_partitions` registry, which
 * `platform_app` can write. For each month m in [current, current + 2] (UTC) an attached, not detach-pending partition
 * of `public.audit_entries` named `audit_entries_<YYYY_MM>`, `relkind = 'r'`, owned by `platform_audit_owner` must
 * exist; any missing month → `unavailable` (every audited write of that month would fail with 23514). In addition,
 * any `public` relation, or non-relation type, whose name matches `^audit_entries_[0-9]{4}_[0-9]{2}$` and that is not
 * such a partition → `unavailable` plus the security event `audit_partition_squatted`, whatever the month, so a
 * far-future squat is reported on the day it is planted. Month current + 3 missing (the daily job is late:
 * `ensure_audit_partitions(3)` keeps it) → `degraded` (AT-US-012-04). The body carries the component state only.
 */
import { isNativeError } from 'node:util/types';

import type { CheckOutcome, ReadinessCheck } from '../../runtime/readiness.js';
import { AUDIT_READINESS_INTERVAL_MS, type CatalogReader, intervalCache } from './catalog-reader.js';

/** Name of a monthly audit partition (data-model §5.3). */
export const AUDIT_PARTITION_NAME = /^audit_entries_[0-9]{4}_[0-9]{2}$/u;

/** Months that must be partitioned for the process to be ready: current, +1, +2. */
export const REQUIRED_MONTHS_AHEAD = 2;
/** The month `ensure_audit_partitions(3)` pre-creates last; its absence only degrades. */
export const EXPECTED_MONTHS_AHEAD = 3;

/**
 * Every `public` object under a partition name: relations (with their attachment state) and free-standing types
 * (`typrelid = 0`: enums, domains, composite types created with CREATE TYPE; a relation's own row type is excluded).
 * The regex anchors at both ends, so a partition's own indexes (`audit_entries_2026_11_…`) do not match.
 *
 * Every operator is written `OPERATOR(pg_catalog.…)` with `oid` on both sides of each `=`, and every type is qualified
 * (PR24-SEC-02): `platform_app`'s path is `pg_catalog, public`, so a bare `=` would resolve to a better-matching
 * operator planted in `public` (for example `public.=(oid, integer)`), which could hide squat rows from this query or
 * make every load fail.
 */
export const PARTITION_CATALOGUE_SQL = `SELECT c.relname::pg_catalog.text AS name,
       c.relkind::pg_catalog.text AS kind,
       COALESCE(i.inhparent OPERATOR(pg_catalog.=) pg_catalog.to_regclass('public.audit_entries')::pg_catalog.oid, false) AS attached,
       COALESCE(i.inhdetachpending, false) AS detach_pending,
       COALESCE(c.relowner OPERATOR(pg_catalog.=) pg_catalog.to_regrole('platform_audit_owner')::pg_catalog.oid, false) AS audit_owned
  FROM pg_catalog.pg_class c
  LEFT JOIN pg_catalog.pg_inherits i ON i.inhrelid OPERATOR(pg_catalog.=) c.oid
 WHERE c.relnamespace OPERATOR(pg_catalog.=) 'public'::pg_catalog.regnamespace::pg_catalog.oid
   AND c.relname OPERATOR(pg_catalog.~) '^audit_entries_[0-9]{4}_[0-9]{2}$'::pg_catalog.text
UNION ALL
SELECT t.typname::pg_catalog.text, 'type'::pg_catalog.text, false, false, false
  FROM pg_catalog.pg_type t
 WHERE t.typnamespace OPERATOR(pg_catalog.=) 'public'::pg_catalog.regnamespace::pg_catalog.oid
   AND t.typrelid OPERATOR(pg_catalog.=) 0::pg_catalog.oid
   AND t.typname OPERATOR(pg_catalog.~) '^audit_entries_[0-9]{4}_[0-9]{2}$'::pg_catalog.text`;

/** One row of {@link PARTITION_CATALOGUE_SQL}. */
export interface PartitionCatalogueRow {
  readonly name: string;
  readonly kind: string;
  readonly attached: boolean;
  readonly detach_pending: boolean;
  readonly audit_owned: boolean;
}

/** An object under a partition name that is not a verified partition. */
export interface SquattedObject {
  readonly name: string;
  /** `pg_class.relkind` (`r`, `i`, `S`, `v`, `m`, `c`, `f`, `p`), or `type`. */
  readonly kind: string;
  /** Why it is not a verified partition. */
  readonly reason: 'not_a_table' | 'not_attached' | 'detach_pending' | 'foreign_owner' | 'duplicate_name';
}

export interface PartitionEvaluation {
  readonly status: 'ok' | 'degraded' | 'unavailable';
  /** Required months (current .. current + 2) without a verified partition. */
  readonly missing: readonly string[];
  /** current + 3 has no verified partition (degraded only). */
  readonly late: boolean;
  readonly squatted: readonly SquattedObject[];
}

/** `audit_entries_YYYY_MM` of the UTC month `offset` months after `now`'s. */
export function partitionNameFor(now: Date, offset: number): string {
  const index = now.getUTCFullYear() * 12 + now.getUTCMonth() + offset;
  return `audit_entries_${String(Math.floor(index / 12)).padStart(4, '0')}_${String((index % 12) + 1).padStart(2, '0')}`;
}

function squatReason(row: PartitionCatalogueRow): SquattedObject['reason'] | undefined {
  if (row.kind !== 'r') return 'not_a_table';
  if (!row.attached) return 'not_attached';
  if (row.detach_pending) return 'detach_pending';
  if (!row.audit_owned) return 'foreign_owner';
  return undefined;
}

/** Pure evaluation of the catalogue rows at `now` (unit-tested arithmetic, TASK-033 item 4). */
export function evaluatePartitions(rows: readonly PartitionCatalogueRow[], now: Date): PartitionEvaluation {
  const verified = new Set<string>();
  const squatted: SquattedObject[] = [];
  const seen = new Map<string, number>();
  for (const row of rows) seen.set(row.name, (seen.get(row.name) ?? 0) + 1);
  for (const row of rows) {
    if (!AUDIT_PARTITION_NAME.test(row.name)) continue; // the SQL filters already; defensive at the boundary
    const reason = (seen.get(row.name) ?? 0) > 1 ? 'duplicate_name' : squatReason(row);
    if (reason === undefined) verified.add(row.name);
    else squatted.push({ name: row.name, kind: row.kind, reason });
  }
  const missing: string[] = [];
  for (let offset = 0; offset <= REQUIRED_MONTHS_AHEAD; offset += 1) {
    const name = partitionNameFor(now, offset);
    if (!verified.has(name)) missing.push(name);
  }
  const late = !verified.has(partitionNameFor(now, EXPECTED_MONTHS_AHEAD));
  const status = missing.length > 0 || squatted.length > 0 ? 'unavailable' : late ? 'degraded' : 'ok';
  return { status, missing, late, squatted };
}

const isRow = (value: unknown): value is PartitionCatalogueRow => {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row['name'] === 'string' &&
    typeof row['kind'] === 'string' &&
    typeof row['attached'] === 'boolean' &&
    typeof row['detach_pending'] === 'boolean' &&
    typeof row['audit_owned'] === 'boolean'
  );
};

/** Thrown (never shown in the body) when the check is not ready. */
export class AuditPartitionsUnavailableError extends Error {
  constructor(readonly evaluation: PartitionEvaluation) {
    super('audit partitions not ready');
    this.name = 'AuditPartitionsUnavailableError';
  }
}

export interface AuditPartitionsCheckOptions {
  /** Security event sink: called once per newly seen squatted object (not once per readiness poll). */
  readonly onSquatted: (object: SquattedObject) => void;
  readonly now?: () => Date;
  readonly intervalMs?: number;
}

/** The `audit_partitions` component (critical). */
export function createAuditPartitionsCheck(reader: CatalogReader, options: AuditPartitionsCheckOptions): ReadinessCheck {
  const now = options.now ?? (() => new Date());
  const reported = new Set<string>();
  // An `unavailable` evaluation is re-read on the next poll, so readiness recovers as soon as the month is repaired
  // (R1-n4); squat events stay deduplicated by `reported`.
  const cache = intervalCache<PartitionEvaluation>(
    options.intervalMs ?? AUDIT_READINESS_INTERVAL_MS,
    () => now().getTime(),
    (evaluation) => evaluation.status !== 'unavailable',
  );
  const load = async (): Promise<PartitionEvaluation> => {
    const result = await reader.query(PARTITION_CATALOGUE_SQL);
    if (!result.rows.every(isRow)) throw new TypeError('unexpected audit partition catalogue row shape');
    const evaluation = evaluatePartitions(result.rows, now());
    for (const object of evaluation.squatted) {
      const key = `${object.kind}:${object.name}:${object.reason}`;
      if (reported.has(key)) continue;
      reported.add(key);
      options.onSquatted(object);
    }
    return evaluation;
  };
  return Object.freeze({
    name: 'audit_partitions' as const,
    critical: true,
    async check(signal: AbortSignal): Promise<CheckOutcome> {
      signal.throwIfAborted();
      const evaluation = await cache.get(load);
      if (evaluation.status === 'unavailable') throw new AuditPartitionsUnavailableError(evaluation);
      return evaluation.status === 'degraded' ? 'degraded' : undefined;
    },
  });
}

/** True for the error {@link createAuditPartitionsCheck} rejects with when the catalogue says "not ready". */
export const isPartitionsUnavailable = (error: unknown): error is AuditPartitionsUnavailableError =>
  isNativeError(error) && error.name === 'AuditPartitionsUnavailableError';
