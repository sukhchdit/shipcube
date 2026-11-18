/**
 * The log matcher covers the classification registry (D-ARCH-150, ADR-0007 amendment 13; NFR-PRIV-001/003; PR #61
 * R1-m3 (c); TASK-028). "The registry feeds the Pino redaction list" is enforced at build time: every column the
 * registry classes PERSONAL, SENSITIVE_PERSONAL or SECRET is written as REDACTED or OMITTED by the logger's
 * `redactValue` when it appears as a log key, or it holds a reasoned exception below (checked both ways). A task whose
 * new column fails this test adds a key to `packages/shared/src/logging/string-redaction.ts` or a reasoned exception.
 * The list is not generated at run time: a column name is unique within its table, a log key is global, so a run-time
 * union would redact `description` or `city` in every log line (D-ARCH-150).
 */
import { describe, expect, it } from '@jest/globals';

import { BINARY, OMITTED, REDACTED, redactValue } from '../logging/redaction.js';
import { type ClassificationRegistry, CLASSIFICATION_REGISTRY, type FieldClassification, registeredColumns } from './registry.js';

const LOGGED_AS_HIDDEN: ReadonlySet<FieldClassification> = new Set(['PERSONAL', 'SENSITIVE_PERSONAL', 'SECRET']);

/**
 * Registered PERSONAL / SENSITIVE_PERSONAL / SECRET columns the log matcher does not cover by key, each with its reason
 * (exact `table.column`; a stale or covered entry fails).
 */
const EXCEPTIONS: Readonly<Record<string, string>> = {
  // bytea: the HMAC of a vault value under AUDIT_VAULT_HMAC_KEY. The logger writes any binary value as [Binary], never
  // its bytes, and the vault is read only through packages/audit (no log path carries the column by name).
  'audit_pii_vault.value_hmac': 'bytea, written as [Binary] by the logger; vault rows are never logged',
  // bytea: AES-256-GCM ciphertext of a PER/SPER value; [Binary] as above, and undecryptable without AUDIT_VAULT_KEY.
  'audit_pii_vault.ciphertext': 'bytea, written as [Binary] by the logger; ciphertext under AUDIT_VAULT_KEY',
};

/** `table.column` of every hidden-class registry column that `redactValue` writes in clear under its own name. */
function uncovered(registry: ClassificationRegistry): string[] {
  return registeredColumns(registry)
    .filter(({ classification }) => LOGGED_AS_HIDDEN.has(classification))
    .filter(({ column }) => {
      const written = (redactValue({ [column]: 'probe-value' }) as Record<string, unknown>)[column];
      return written !== REDACTED && written !== OMITTED;
    })
    .map(({ table, column }) => `${table}.${column}`)
    .sort();
}

describe('[D-ARCH-150] [NFR-PRIV-001] the logger hides every PERSONAL, SENSITIVE_PERSONAL and SECRET registry column', () => {
  it('every uncovered column is a reasoned exception, and every exception is an uncovered registry column', () => {
    expect(uncovered(CLASSIFICATION_REGISTRY)).toEqual(Object.keys(EXCEPTIONS).sort());
  });

  it('every exception names a registered column of a hidden class', () => {
    const hidden = new Set(
      registeredColumns()
        .filter(({ classification }) => LOGGED_AS_HIDDEN.has(classification))
        .map(({ table, column }) => `${table}.${column}`),
    );
    for (const key of Object.keys(EXCEPTIONS)) expect([key, hidden.has(key)]).toEqual([key, true]);
  });

  it('the bytea exceptions are written as [Binary] by the logger, never as their bytes', () => {
    for (const column of ['value_hmac', 'ciphertext']) {
      expect((redactValue({ [column]: new Uint8Array(32) }) as Record<string, unknown>)[column]).toBe(BINARY);
    }
  });

  it('planted: a PERSONAL column the matcher misses fails, naming table.column; a covered one passes', () => {
    const planted: ClassificationRegistry = { users: { nickname: 'PERSONAL', password_hash: 'SECRET', id: 'INTERNAL' } };
    expect(uncovered(planted)).toEqual(['users.nickname']);
  });
});
