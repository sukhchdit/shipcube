import { createPrismaAuditStore } from '@platform/audit';

// PR #42 R1-M1 / PR42-SEC-06: the store appends any row and writes vault rows without the entry contract.
export const store: unknown = createPrismaAuditStore;
