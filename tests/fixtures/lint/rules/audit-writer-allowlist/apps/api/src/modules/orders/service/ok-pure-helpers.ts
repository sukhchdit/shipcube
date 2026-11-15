import { AUDIT_ENTRY_ACTIONS, computeEntryHash } from '@platform/audit';

// Pure helpers (vocabularies, the entry hash) write nothing and stay importable outside the allow-list.
export const helpers: readonly unknown[] = [AUDIT_ENTRY_ACTIONS, computeEntryHash];
