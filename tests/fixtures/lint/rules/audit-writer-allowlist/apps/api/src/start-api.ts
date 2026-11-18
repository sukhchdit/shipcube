import { createAuditPrivacy } from '@platform/audit';

// PR #61 R1-M2: the API composition root (exact file) builds the capture's privacy dependencies.
export const privacy: unknown = createAuditPrivacy;
