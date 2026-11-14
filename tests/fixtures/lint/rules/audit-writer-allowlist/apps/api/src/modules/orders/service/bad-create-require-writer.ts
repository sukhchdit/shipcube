import { createRequire as mk } from 'node:module';

/** PR44-SEC-01 A05: the audit writer through an aliased createRequire. */
export const writer = (mk(import.meta.url)('@platform/audit') as { createAuditWriter: unknown }).createAuditWriter;
