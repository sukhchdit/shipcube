import { createAuditPrivacy } from '@platform/audit';

// PR #61 R1-M2: the privacy composition returns the vault tokeniser; only the composition roots build it.
export const privacy: unknown = createAuditPrivacy;
