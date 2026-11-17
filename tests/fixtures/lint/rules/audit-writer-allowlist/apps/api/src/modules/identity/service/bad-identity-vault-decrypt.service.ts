import { decryptVaultValue } from '@platform/audit';

// PR #61 R1-M2: the writer allow-list may write entries, not decrypt the vault.
export const decrypt: unknown = decryptVaultValue;
