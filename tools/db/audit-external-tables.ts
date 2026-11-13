/**
 * Prisma `tables.external` list (data-model.md §7.3 amendment 2026-11-13, SPK-08 F-01; PR12-SEC-07, D-SEC-PR12-01,
 * D-ARCH-077; TASK-021).
 *
 * The audit objects are created by the bootstrap lane (`prisma/bootstrap/10-audit.sql`) and owned by
 * `platform_audit_owner`; Prisma Migrate must never diff them. Prisma's "schema not empty" check (P3005 on the first
 * `migrate deploy`) also counts the monthly partitions, so listing the eight parents is not enough: every partition
 * name must be listed too. Non-existent external names are accepted, so the list carries a GENERATED, BOUNDED window
 * of partition names, 2026-01 to the current UTC month + 24. Pure function of the clock; no database access.
 */

/** The bootstrap-lane ledger (data-model §8.1). */
export const BOOTSTRAP_LEDGER = 'public.bootstrap_migrations';

/** The eight audit tables of data-model §4.4, in `public`. */
export const AUDIT_TABLES = [
  'audit_entries',
  'audit_stream_heads',
  'audit_checkpoint_heads',
  'audit_chain_verifications',
  'audit_partitions',
  'audit_anchors',
  'audit_pii_vault',
  'data_subjects',
] as const;

/** First month of the partition-name window (the platform holds no audit entry before it). */
export const AUDIT_WINDOW_START = Object.freeze({ year: 2026, month: 1 });

/** Months after the current UTC month covered by the window (ensure_audit_partitions creates at most +12). */
export const AUDIT_WINDOW_MONTHS_AHEAD = 24;

/** `audit_entries_YYYY_MM` for a 1-based month. */
export function auditPartitionName(year: number, month: number): string {
  return `audit_entries_${String(year).padStart(4, '0')}_${String(month).padStart(2, '0')}`;
}

/** Partition names from {@link AUDIT_WINDOW_START} to the UTC month of `now` + {@link AUDIT_WINDOW_MONTHS_AHEAD}. */
export function auditPartitionWindow(now: Date): string[] {
  if (Number.isNaN(now.getTime())) throw new RangeError('auditPartitionWindow: invalid date');
  const startIndex = AUDIT_WINDOW_START.year * 12 + (AUDIT_WINDOW_START.month - 1);
  const endIndex = now.getUTCFullYear() * 12 + now.getUTCMonth() + AUDIT_WINDOW_MONTHS_AHEAD;
  const names: string[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    names.push(auditPartitionName(Math.floor(index / 12), (index % 12) + 1));
  }
  return names;
}

/** The complete `tables.external` list: the ledger, the eight audit tables and the partition window. */
export function externalTables(now: Date = new Date()): string[] {
  return [
    BOOTSTRAP_LEDGER,
    ...AUDIT_TABLES.map((table) => `public.${table}`),
    ...auditPartitionWindow(now).map((name) => `public.${name}`),
  ];
}
