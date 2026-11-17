import { createVaultTokeniser } from '@platform/audit';

// PR #61 R1-M2 / PR61-SEC-02: the tokeniser INSERTs data_subjects and audit_pii_vault rows outside the writer contract.
export const tokeniser: unknown = createVaultTokeniser;
