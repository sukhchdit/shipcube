import { createAuditWriter, createPrismaAuditStore } from '@platform/audit';

/** Stand-in for apps/api/src/platform/audit/writer.ts: the writer composed over the Prisma store (allow-listed folder). */
export interface AuditWriterDeps {
  readonly lockTimeoutMs: number;
}

export const auditWriterFromConfig = (deps: AuditWriterDeps): unknown =>
  createAuditWriter({ store: createPrismaAuditStore(), lockTimeoutMs: deps.lockTimeoutMs });
