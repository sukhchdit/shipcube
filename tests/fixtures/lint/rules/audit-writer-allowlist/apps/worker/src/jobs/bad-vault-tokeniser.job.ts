import { createVaultTokeniser } from '@platform/audit';

// PR #61 R1-M2: a worker job may not plant vault rows outside the writer (the worker root composes, TASK-047).
export const tokeniser: unknown = createVaultTokeniser;
