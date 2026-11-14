import { createAuditWriter, createPrismaAuditStore } from '@platform/audit';

// The audit middleware composes the writer over the store (allow-listed folder).
export const writer: unknown = createAuditWriter({ store: createPrismaAuditStore(), lockTimeoutMs: 250 });
