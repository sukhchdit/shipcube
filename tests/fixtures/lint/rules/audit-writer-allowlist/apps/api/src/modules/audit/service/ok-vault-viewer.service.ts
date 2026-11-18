import { auditKeyOf, decryptVaultValue } from '@platform/audit';

// PR #61 R1-M2: the audit viewer module (TASK-073) resolves vault tokens as an audited SENSITIVE view.
export const resolve: readonly unknown[] = [decryptVaultValue, auditKeyOf];
