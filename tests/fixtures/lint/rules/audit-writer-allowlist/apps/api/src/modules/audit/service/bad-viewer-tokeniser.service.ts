import { createVaultTokeniser } from '@platform/audit';

// PR #61 R1-M2: the audit viewer may decrypt the vault, but never write it.
export const tokeniser: unknown = createVaultTokeniser;
