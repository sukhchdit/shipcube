import { describe, expect, it, jest } from '@jest/globals';
import { ANONYMOUS_ACTOR_ID } from '@platform/shared';

import type { AuditEntryInput, PiiValue } from './entry.js';
import { AuditWriteError } from './errors.js';
import type { AppendedEntry, AppendOptions, AuditStore } from './store/prisma-store.js';
import { createPrismaAuditStore } from './store/prisma-store.js';
import { driverError, fakeSql, headRow } from './tests/fake-sql.js';
import type { AuditRowDraft } from './entry-hash.js';
import { createAuditWriter, type PiiTokeniser } from './writer.js';

const ORG = '019a7c3e-0000-7000-8000-0000000000aa';
const USER = '019a7c3e-0000-7000-8000-0000000000bb';
const ID = '019a7c3e-0000-7000-8000-000000000001';
const TOKEN = '019a7c3e-0000-7000-8000-0000000000c1';

const CREATE: AuditEntryInput = {
  action: 'CREATE',
  outcome: 'SUCCESS',
  entityName: 'address',
  entityId: 'a-1',
  orgId: ORG,
  actor: { type: 'USER', userId: USER, roles: ['Shipper'] },
  origin: { sourceApp: 'web', correlationId: 'corr-0001-writer', httpMethod: 'POST', route: '/addresses' },
  newValue: { city: 'Pune' },
};

const APPENDED: AppendedEntry = {
  id: ID,
  streamId: ORG,
  streamSeq: 1,
  occurredAt: 'x',
  prevHash: '00'.repeat(32),
  entryHash: '11'.repeat(32),
};

function recordingStore(result: Promise<AppendedEntry> = Promise.resolve(APPENDED)) {
  const calls: Array<{ row: AuditRowDraft; options: AppendOptions }> = [];
  const store: AuditStore = {
    append: (_db, row, options) => {
      calls.push({ row, options });
      return result;
    },
    insertVaultRows: () => Promise.reject(new Error('not used')),
  };
  return { store, calls };
}

const db = fakeSql();

describe('[US-088] audit writer (one call per complete entry; ADR-0007 am. 10 items 1-2)', () => {
  it('validates, then appends inside the given transaction with the configured lock timeout and the actor stamp', async () => {
    const { store, calls } = recordingStore();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250, newId: () => ID });
    await expect(writer.write(db, CREATE)).resolves.toBe(APPENDED);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toEqual({ lockTimeoutMs: 250, actorStamp: USER });
    expect(calls[0]?.row).toMatchObject({ id: ID, streamId: ORG, action: 'CREATE', newValue: { city: 'Pune' } });
  });

  it('an anonymous entry without an organisation goes to the drawn SYSTEM shard, stamped by the ANONYMOUS actor', async () => {
    const { store, calls } = recordingStore();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250, newId: () => ID, systemShard: () => 10 });
    await writer.write(db, { ...CREATE, orgId: null, actor: { type: 'ANONYMOUS' } });
    expect(calls[0]?.row.streamId).toBe('00000000-0000-0000-0000-00000000000a');
    expect(calls[0]?.options.actorStamp).toBe(ANONYMOUS_ACTOR_ID);
  });

  it('the default shard draw is server-side and uniform over 16 shards; the default id is a UUIDv7', async () => {
    const { store, calls } = recordingStore();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250 });
    for (let i = 0; i < 64; i += 1) await writer.write(db, { ...CREATE, orgId: null, actor: { type: 'ANONYMOUS' } });
    const shards = new Set(calls.map((call) => call.row.streamId));
    expect(shards.size).toBeGreaterThan(4);
    for (const shard of shards) expect(shard).toMatch(/^00000000-0000-0000-0000-0000000000[0-9a-f]{2}$/);
    expect(calls[0]?.row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('tokenises every personal value in ONE batch call before the append, and substitutes the tokens', async () => {
    const { store, calls } = recordingStore();
    const batches: Array<readonly PiiValue[]> = [];
    const tokeniser: PiiTokeniser = {
      tokenise: (_db, values) => {
        batches.push(values);
        return Promise.resolve(values.map((_value, index) => `019a7c3e-0000-7000-8000-0000000000c${String(index + 1)}`));
      },
    };
    const writer = createAuditWriter({ store, lockTimeoutMs: 250, tokeniser, newId: () => ID });
    await writer.write(db, { ...CREATE, origin: { ...CREATE.origin, ip: '203.0.113.9', userAgent: 'curl/8' }, reason: 'asked' });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((value) => value.field)).toEqual(['ip', 'user_agent', 'reason']);
    expect(calls[0]?.row).toMatchObject({
      ipToken: '019a7c3e-0000-7000-8000-0000000000c1',
      userAgentToken: '019a7c3e-0000-7000-8000-0000000000c2',
      reasonToken: '019a7c3e-0000-7000-8000-0000000000c3',
      piiTokenCount: 3,
    });
  });

  it('an entry without personal values never calls the tokeniser', async () => {
    const tokenise = jest.fn<PiiTokeniser['tokenise']>();
    const writer = createAuditWriter({ store: recordingStore().store, lockTimeoutMs: 250, tokeniser: { tokenise } });
    await writer.write(db, CREATE);
    expect(tokenise).not.toHaveBeenCalled();
  });

  it('personal values without a tokeniser fail closed (TOKENISER_UNAVAILABLE), nothing is appended', async () => {
    const { store, calls } = recordingStore();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250 });
    await expect(writer.write(db, { ...CREATE, origin: { ...CREATE.origin, ip: '203.0.113.9' } })).rejects.toMatchObject({
      kind: 'TOKENISER_UNAVAILABLE',
      reason: 'AUDIT_WRITE_FAILED',
    });
    expect(calls).toHaveLength(0);
  });

  it('tokeniser failures: a database failure keeps its SQLSTATE, anything else is TOKENISER_FAILED', async () => {
    const store = recordingStore().store;
    const entry = { ...CREATE, origin: { ...CREATE.origin, ip: '203.0.113.9' } };
    const failing = (error: Error) =>
      createAuditWriter({ store, lockTimeoutMs: 250, tokeniser: { tokenise: () => Promise.reject(error) } }).write(db, entry);
    await expect(failing(driverError('55P03'))).rejects.toMatchObject({ kind: 'LOCK_TIMEOUT', status: 503, retryable: true });
    await expect(failing(new Error('kms down'))).rejects.toMatchObject({ kind: 'TOKENISER_FAILED', status: 500 });
    const wrongCount = createAuditWriter({ store, lockTimeoutMs: 250, tokeniser: { tokenise: () => Promise.resolve([TOKEN, TOKEN]) } });
    await expect(wrongCount.write(db, entry)).rejects.toMatchObject({ kind: 'TOKENISER_FAILED' });
  });

  it('[AT-US-088-01] an append failure is AUDIT_WRITE_FAILED (500); a lock timeout is AUDIT_LOCK_TIMEOUT (503, Retry-After 1)', async () => {
    const write = (error: Error) =>
      createAuditWriter({ store: recordingStore(Promise.reject(error)).store, lockTimeoutMs: 250 }).write(db, CREATE);
    await expect(write(driverError('23514', 'no partition of relation "audit_entries" found for row'))).rejects.toMatchObject({
      reason: 'AUDIT_WRITE_FAILED',
      kind: 'PARTITION_MISSING',
      status: 500,
      retryable: false,
    });
    await expect(write(driverError('55P03'))).rejects.toMatchObject({ reason: 'AUDIT_LOCK_TIMEOUT', status: 503, retryAfterSeconds: 1 });
    await expect(write(new AuditWriteError('HEAD_MOVED'))).rejects.toMatchObject({ kind: 'HEAD_MOVED' });
    await expect(write(new Error('socket closed'))).rejects.toMatchObject({ kind: 'DATABASE_ERROR', status: 500 });
  });

  it('an invalid entry, a throwing accessor or a failing IP index is refused before any statement', async () => {
    const sql = fakeSql();
    const writer = createAuditWriter({ store: createPrismaAuditStore(), lockTimeoutMs: 250 });
    await expect(writer.write(sql, { ...CREATE, action: 'FOO' as 'CREATE' })).rejects.toMatchObject({
      kind: 'INVALID_ENTRY',
      field: 'action',
    });
    const hostile = Object.defineProperty({ ...CREATE }, 'entityName', {
      get: () => {
        throw new Error('getter');
      },
    });
    await expect(writer.write(sql, hostile)).rejects.toMatchObject({ kind: 'INVALID_ENTRY' });
    const indexed = createAuditWriter({
      store: createPrismaAuditStore(),
      lockTimeoutMs: 250,
      ipIndex: {
        keyId: 'audit-index-v1',
        hash: () => {
          throw new Error('hmac');
        },
      },
    });
    await expect(indexed.write(sql, { ...CREATE, origin: { ...CREATE.origin, ip: '203.0.113.9' } })).rejects.toMatchObject({
      kind: 'INVALID_ENTRY',
    });
    expect(sql.statements).toHaveLength(0);
  });

  it('end to end on the real store over a fake port: lock, append; statement failures classified', async () => {
    const writer = createAuditWriter({ store: createPrismaAuditStore(), lockTimeoutMs: 300, newId: () => ID });
    const ok = fakeSql(headRow(0), 1);
    await expect(writer.write(ok, CREATE)).resolves.toMatchObject({ id: ID, streamSeq: 1 });
    expect(ok.statements[0]?.values[0]).toBe('300');
    await expect(writer.write(fakeSql(driverError('55P03')), CREATE)).rejects.toMatchObject({ reason: 'AUDIT_LOCK_TIMEOUT' });
  });

  it('refuses a non-positive lock timeout at construction', () => {
    expect(() => createAuditWriter({ store: recordingStore().store, lockTimeoutMs: 0 })).toThrow(RangeError);
  });
});
