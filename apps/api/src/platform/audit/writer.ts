/**
 * The audit writer composed from the validated configuration (PR #42 R1-n5; ADR-0007 am. 10 item 2): the store's
 * head-row lock waits `DB_AUDIT_LOCK_TIMEOUT_MS`, the key the config guard keeps below `DB_TX_LOCK_TIMEOUT_MS`
 * (`databaseGuard`, packages/config). The capture hook (TASK-029, D-ARCH-122) builds its writer here, so the running
 * writer and the guarded value cannot differ.
 */
import { type AuditWriter, type AuditWriterOptions, createAuditWriter, createPrismaAuditStore } from '@platform/audit';
import type { Config } from '@platform/config';

/** Everything but the lock timeout; the store defaults to the Prisma store over the business transaction. */
export type AuditWriterDeps = Omit<AuditWriterOptions, 'lockTimeoutMs' | 'store'> & { readonly store?: AuditWriterOptions['store'] };

export function auditWriterFromConfig(config: Pick<Config, 'DB_AUDIT_LOCK_TIMEOUT_MS'>, deps: AuditWriterDeps = {}): AuditWriter {
  const { store, ...rest } = deps;
  return createAuditWriter({ ...rest, store: store ?? createPrismaAuditStore(), lockTimeoutMs: config.DB_AUDIT_LOCK_TIMEOUT_MS });
}
