import { describe, expect, it } from '@jest/globals';
import type { AuditEntryInput, AuditSqlPort, AuditStore } from '@platform/audit';
import { DB_AUDIT_LOCK_TIMEOUT_MS_DEFAULT } from '@platform/config';

import { auditWriterFromConfig } from './writer.js';

const ORG = '019a7c3e-0000-7000-8000-0000000000aa';
const USER = '019a7c3e-0000-7000-8000-0000000000bb';

const ENTRY: AuditEntryInput = {
  action: 'CREATE',
  outcome: 'SUCCESS',
  entityName: 'address',
  entityId: 'a-1',
  orgId: ORG,
  actor: { type: 'USER', userId: USER },
  origin: { sourceApp: 'web', correlationId: 'corr-0001-compose' },
};

/** A port that answers statement 2 with an empty head and statement 4 with one row, recording the bound values. */
function port(): AuditSqlPort & { readonly bound: unknown[][] } {
  const bound: unknown[][] = [];
  return {
    bound,
    $queryRaw<T>(_query: TemplateStringsArray, ...values: unknown[]): Promise<T> {
      bound.push(values);
      return Promise.resolve([{ entry_count: '0', head_hash: '00'.repeat(32), head_us: null, now_us: '1763000000123456' }] as T);
    },
    $executeRaw(_query: TemplateStringsArray, ...values: unknown[]): Promise<number> {
      bound.push(values);
      return Promise.resolve(1);
    },
    markRollbackOnly(): void {
      throw new Error('not expected');
    },
    track: (work) => work(),
  };
}

describe('[PR #42 R1-n5] the composed writer takes DB_AUDIT_LOCK_TIMEOUT_MS from the configuration', () => {
  it('the configured value is the lock_timeout bound in the head-row lock statement', async () => {
    const db = port();
    await auditWriterFromConfig({ DB_AUDIT_LOCK_TIMEOUT_MS: 321 }).write(db, ENTRY);
    expect(db.bound[0]?.[0]).toBe('321');
  });

  it('a supplied store and the other options pass through; the lock timeout still comes from the configuration', async () => {
    const calls: Array<{ readonly id: string; readonly lockTimeoutMs: number }> = [];
    const store: AuditStore = {
      append: (_db, row, options) => {
        calls.push({ id: row.id, lockTimeoutMs: options.lockTimeoutMs });
        return Promise.resolve({ id: row.id, streamId: row.streamId, streamSeq: 1, occurredAt: 'x', prevHash: '', entryHash: '' });
      },
      insertVaultRows: () => Promise.reject(new Error('not used')),
    };
    const id = '019a7c3e-0000-7000-8000-000000000009';
    await auditWriterFromConfig({ DB_AUDIT_LOCK_TIMEOUT_MS: DB_AUDIT_LOCK_TIMEOUT_MS_DEFAULT }, { store, newId: () => id }).write(
      port(),
      ENTRY,
    );
    expect(calls).toEqual([{ id, lockTimeoutMs: DB_AUDIT_LOCK_TIMEOUT_MS_DEFAULT }]);
  });
});
