import { auditKeyOf, decryptVaultValue } from '@platform/audit';

// PR #61 R1-M2: vault reads are audited SENSITIVE views of the audit viewer only (ADR-0007 §Privacy erasure).
export const decrypt: readonly unknown[] = [decryptVaultValue, auditKeyOf];
