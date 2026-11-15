import { describe, expect, it, jest } from '@jest/globals';
import { ANONYMOUS_ACTOR_ID } from '@platform/shared';

import type { AuditEntryInput, PiiValue } from './entry.js';
import { AuditWriteError } from './errors.js';
import type { AppendedEntry, AppendOptions, AuditStore } from './store/prisma-store.js';
import { createPrismaAuditStore } from './store/prisma-store.js';
import { driverError, type FakeSql, fakeSql, headRow } from './tests/fake-sql.js';
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

/** A store double: one call per appended row (in batch order); every row answers APPENDED, or the failure. */
function recordingStore(result: Promise<AppendedEntry> = Promise.resolve(APPENDED)) {
  const calls: Array<{ row: AuditRowDraft; options: AppendOptions }> = [];
  const batches: Array<readonly AuditRowDraft[]> = [];
  const store: AuditStore = {
    appendBatch: async (_db, rows, options) => {
      batches.push(rows);
      for (const row of rows) calls.push({ row, options });
      const appended = await result;
      return rows.map(() => appended);
    },
    insertVaultRows: () => Promise.reject(new Error('not used')),
  };
  return { store, calls, batches };
}

/** A fresh transaction of the organisation ORG (one flush per transaction, D-ARCH-122). */
const tx = (...script: Parameters<typeof fakeSql>): FakeSql => Object.assign(fakeSql(...script), { orgId: ORG });

describe('[US-088] audit writer (one call per complete entry; ADR-0007 am. 10 items 1-2)', () => {
  it('validates, then appends inside the given transaction with the configured lock timeout and the actor stamp', async () => {
    const { store, calls } = recordingStore();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250, newId: () => ID });
    await expect(writer.write(tx(), CREATE)).resolves.toBe(APPENDED);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toEqual({ lockTimeoutMs: 250, actorStamp: USER });
    expect(calls[0]?.row).toMatchObject({ id: ID, streamId: ORG, action: 'CREATE', newValue: { city: 'Pune' } });
  });

  it('an anonymous entry without an organisation goes to the drawn SYSTEM shard, stamped by the ANONYMOUS actor', async () => {
    const { store, calls } = recordingStore();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250, newId: () => ID, systemShard: () => 10 });
    await writer.write(tx(), { ...CREATE, orgId: null, actor: { type: 'ANONYMOUS' } });
    expect(calls[0]?.row.streamId).toBe('00000000-0000-0000-0000-00000000000a');
    expect(calls[0]?.options.actorStamp).toBe(ANONYMOUS_ACTOR_ID);
  });

  it('the default shard draw is server-side and uniform over 16 shards; the default id is a UUIDv7', async () => {
    const { store, calls } = recordingStore();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250 });
    for (let i = 0; i < 64; i += 1) await writer.write(tx(), { ...CREATE, orgId: null, actor: { type: 'ANONYMOUS' } });
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
    await writer.write(tx(), { ...CREATE, origin: { ...CREATE.origin, ip: '203.0.113.9', userAgent: 'curl/8' }, reason: 'asked' });
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
    await writer.write(tx(), CREATE);
    expect(tokenise).not.toHaveBeenCalled();
  });

  it('personal values without a tokeniser fail closed (TOKENISER_UNAVAILABLE), nothing is appended', async () => {
    const { store, calls } = recordingStore();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250 });
    await expect(writer.write(tx(), { ...CREATE, origin: { ...CREATE.origin, ip: '203.0.113.9' } })).rejects.toMatchObject({
      kind: 'TOKENISER_UNAVAILABLE',
      reason: 'AUDIT_WRITE_FAILED',
    });
    expect(calls).toHaveLength(0);
  });

  it('tokeniser failures: a database failure keeps its SQLSTATE, anything else is TOKENISER_FAILED', async () => {
    const store = recordingStore().store;
    const entry = { ...CREATE, origin: { ...CREATE.origin, ip: '203.0.113.9' } };
    const failing = (error: Error) =>
      createAuditWriter({ store, lockTimeoutMs: 250, tokeniser: { tokenise: () => Promise.reject(error) } }).write(tx(), entry);
    await expect(failing(driverError('55P03'))).rejects.toMatchObject({ kind: 'LOCK_TIMEOUT', status: 503, retryable: true });
    await expect(failing(new Error('kms down'))).rejects.toMatchObject({ kind: 'TOKENISER_FAILED', status: 500 });
    const wrongCount = createAuditWriter({ store, lockTimeoutMs: 250, tokeniser: { tokenise: () => Promise.resolve([TOKEN, TOKEN]) } });
    await expect(wrongCount.write(tx(), entry)).rejects.toMatchObject({ kind: 'TOKENISER_FAILED' });
  });

  it('[AT-US-088-01] an append failure is AUDIT_WRITE_FAILED (500); a lock timeout is AUDIT_LOCK_TIMEOUT (503, Retry-After 1)', async () => {
    const write = (error: Error) =>
      createAuditWriter({ store: recordingStore(Promise.reject(error)).store, lockTimeoutMs: 250 }).write(tx(), CREATE);
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
    const sql = tx();
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
    // R1-n4: an IP-index failure is an infrastructure fault, not a caller bug.
    await expect(indexed.write(sql, { ...CREATE, origin: { ...CREATE.origin, ip: '203.0.113.9' } })).rejects.toMatchObject({
      kind: 'IP_INDEX_FAILED',
      reason: 'AUDIT_WRITE_FAILED',
    });
    expect(sql.statements).toHaveLength(0);
  });

  it('end to end on the real store over a fake port: lock, append; statement failures classified', async () => {
    const writer = createAuditWriter({ store: createPrismaAuditStore(), lockTimeoutMs: 300, newId: () => ID });
    const ok = tx(headRow(0), 1);
    await expect(writer.write(ok, CREATE)).resolves.toMatchObject({ id: ID, streamSeq: 1 });
    expect(ok.statements[0]?.values[0]).toBe('300');
    await expect(writer.write(tx(driverError('55P03')), CREATE)).rejects.toMatchObject({ reason: 'AUDIT_LOCK_TIMEOUT' });
  });

  it('refuses a non-positive lock timeout at construction', () => {
    expect(() => createAuditWriter({ store: recordingStore().store, lockTimeoutMs: 0 })).toThrow(RangeError);
  });
});

describe('[PR42-SEC-02] every refusal marks the transaction rollback-only before it is thrown', () => {
  const withIp: AuditEntryInput = { ...CREATE, origin: { ...CREATE.origin, ip: '203.0.113.9' } };
  const cases: Array<[string, () => { readonly writer: ReturnType<typeof createAuditWriter>; readonly entry: AuditEntryInput }, string]> = [
    [
      'INVALID_ENTRY',
      () => ({
        writer: createAuditWriter({ store: recordingStore().store, lockTimeoutMs: 250 }),
        entry: { ...CREATE, outcome: 'OK' as 'SUCCESS' },
      }),
      'INVALID_ENTRY',
    ],
    [
      'TOKENISER_UNAVAILABLE',
      () => ({ writer: createAuditWriter({ store: recordingStore().store, lockTimeoutMs: 250 }), entry: withIp }),
      'TOKENISER_UNAVAILABLE',
    ],
    [
      'TOKENISER_FAILED',
      () => ({
        writer: createAuditWriter({
          store: recordingStore().store,
          lockTimeoutMs: 250,
          tokeniser: { tokenise: () => Promise.resolve([]) },
        }),
        entry: withIp,
      }),
      'TOKENISER_FAILED',
    ],
    [
      'HEAD_MOVED',
      () => ({
        writer: createAuditWriter({ store: recordingStore(Promise.reject(new AuditWriteError('HEAD_MOVED'))).store, lockTimeoutMs: 250 }),
        entry: CREATE,
      }),
      'HEAD_MOVED',
    ],
    [
      'LOCK_TIMEOUT',
      () => ({
        writer: createAuditWriter({ store: recordingStore(Promise.reject(driverError('55P03'))).store, lockTimeoutMs: 250 }),
        entry: CREATE,
      }),
      'LOCK_TIMEOUT',
    ],
    [
      'IP_INDEX_FAILED',
      () => ({
        writer: createAuditWriter({
          store: recordingStore().store,
          lockTimeoutMs: 250,
          ipIndex: {
            keyId: 'audit-index-v1',
            hash: () => {
              throw new Error('hmac');
            },
          },
        }),
        entry: withIp,
      }),
      'IP_INDEX_FAILED',
    ],
  ];

  it.each(cases)('%s', async (_label, build, kind) => {
    const sql = tx();
    const { writer, entry } = build();
    const thrown = await writer.write(sql, entry).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toMatchObject({ kind });
    expect(sql.marked).toHaveLength(1);
    expect(sql.marked[0]).toBe(thrown);
    expect(sql.tracked()).toBe(1);
  });

  it('a successful write marks nothing', async () => {
    const sql = tx();
    await createAuditWriter({ store: recordingStore().store, lockTimeoutMs: 250 }).write(sql, CREATE);
    expect(sql.marked).toEqual([]);
  });

  it('[PR42-SEC-13] every write is registered through the port track synchronously; a refused track starts nothing', async () => {
    const sql = tx();
    const { store, calls } = recordingStore();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250 });
    const pending = writer.write(sql, CREATE);
    expect(sql.tracked()).toBe(1);
    await pending;
    expect(calls).toHaveLength(1);
    const closed = {
      ...sql,
      track: (): never => {
        throw new Error('TENANT_TX_CLOSED');
      },
    };
    await expect(writer.write(closed, CREATE)).rejects.toThrow('TENANT_TX_CLOSED');
    expect(calls).toHaveLength(1);
    expect(sql.marked).toEqual([]);
  });
});

describe('[PR #42 R1-m2 / PR42-SEC-03] the row is assembled from the validated snapshot, not the caller graph', () => {
  it('mutations of the input during the tokeniser round trip never reach the stored row', async () => {
    const { store, calls } = recordingStore();
    const newValue: Record<string, unknown> = { city: 'Pune', nested: { street: 'MG Road' } };
    const origin = { ...CREATE.origin, ip: '203.0.113.9' };
    const input = { ...CREATE, action: 'LOGIN_FAILED' as const, outcome: 'DENIED' as const, origin, newValue } as AuditEntryInput;
    const mutable = input as unknown as Record<string, unknown>;
    const tokeniser: PiiTokeniser = {
      tokenise: (_db, values) => {
        mutable['outcome'] = 'SUCCESS';
        newValue['owner'] = { $pii: TOKEN };
        newValue['nested'] = new Date(0);
        newValue['city'] = `x${String.fromCharCode(0)}`;
        (origin as Record<string, unknown>)['correlationId'] = 'bad';
        return Promise.resolve(values.map(() => TOKEN));
      },
    };
    await createAuditWriter({ store, lockTimeoutMs: 250, tokeniser, newId: () => ID }).write(tx(), input);
    expect(calls[0]?.row).toMatchObject({
      outcome: 'DENIED',
      correlationId: 'corr-0001-writer',
      newValue: { city: 'Pune', nested: { street: 'MG Road' } },
    });
    expect(Object.keys(calls[0]?.row.newValue as object)).toEqual(['city', 'nested']);
  });

  it('the tokeniser receives the writer-owned copies, so swapping a value in them cannot change the row either', async () => {
    const { store, calls } = recordingStore();
    const seen: PiiValue[][] = [];
    const tokeniser: PiiTokeniser = {
      tokenise: (_db, values) => {
        seen.push([...values]);
        expect(Object.isFrozen(values)).toBe(true);
        expect(values.every((value) => Object.isFrozen(value))).toBe(true);
        return Promise.resolve(values.map(() => TOKEN));
      },
    };
    await createAuditWriter({ store, lockTimeoutMs: 250, tokeniser }).write(tx(), {
      ...CREATE,
      origin: { ...CREATE.origin, ip: '203.0.113.9' },
    });
    expect(seen[0]?.map((value) => value.field)).toEqual(['ip']);
    expect(calls[0]?.row.ipToken).toBe(TOKEN);
  });
});

describe('[D-ARCH-122] record + ONE flush per transaction (ADR-0007 am. 11 item 3; invariants I1-I4)', () => {
  const second: AuditEntryInput = { ...CREATE, entityId: 'a-2', newValue: { city: 'Delhi' } };

  it('record buffers without sending; the flush appends every recorded entry in ONE store batch, in record order', async () => {
    const { store, batches } = recordingStore();
    let next = 0;
    const writer = createAuditWriter({ store, lockTimeoutMs: 250, newId: () => `019a7c3e-0000-7000-8000-00000000010${String(++next)}` });
    const sql = tx();
    writer.record(sql, CREATE);
    writer.record(sql, second);
    expect(batches).toHaveLength(0);
    await expect(writer.flush(sql)).resolves.toEqual([APPENDED, APPENDED]);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((row) => [row.id, row.entityId])).toEqual([
      ['019a7c3e-0000-7000-8000-000000000101', 'a-1'],
      ['019a7c3e-0000-7000-8000-000000000102', 'a-2'],
    ]);
    expect(sql.marked).toEqual([]);
  });

  it('the personal values of ALL recorded entries go to the tokeniser in ONE call, each entry gets its own tokens', async () => {
    const { store, calls } = recordingStore();
    const batches: Array<readonly PiiValue[]> = [];
    const tokeniser: PiiTokeniser = {
      tokenise: (_db, values) => {
        batches.push(values);
        return Promise.resolve(values.map((_value, index) => `019a7c3e-0000-7000-8000-0000000000d${String(index)}`));
      },
    };
    const writer = createAuditWriter({ store, lockTimeoutMs: 250, tokeniser });
    const sql = tx();
    writer.record(sql, { ...CREATE, origin: { ...CREATE.origin, ip: '203.0.113.9' } });
    writer.record(sql, { ...second, origin: { ...CREATE.origin, userAgent: 'curl/8' }, reason: 'asked' });
    await writer.flush(sql);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((value) => value.field)).toEqual(['ip', 'user_agent', 'reason']);
    expect(Object.isFrozen(batches[0])).toBe(true);
    expect(calls.map(({ row }) => [row.ipToken, row.userAgentToken, row.reasonToken])).toEqual([
      ['019a7c3e-0000-7000-8000-0000000000d0', null, null],
      [null, '019a7c3e-0000-7000-8000-0000000000d1', '019a7c3e-0000-7000-8000-0000000000d2'],
    ]);
  });

  it('a flush with nothing recorded sends nothing; the stamp of a SYSTEM_JOB batch is the SYSTEM actor', async () => {
    const { store, calls } = recordingStore();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250 });
    await expect(writer.flush(tx())).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
    const sql = tx();
    writer.record(sql, { ...CREATE, actor: { type: 'SYSTEM_JOB', jobName: 'retention.sweep' } });
    await writer.flush(sql);
    expect(calls[0]?.options.actorStamp).toBe(calls[0]?.row.userId);
  });

  it('[I2] a record after the flush, or a second flush, is WRITE_AFTER_FLUSH (500) and marks the transaction', async () => {
    const writer = createAuditWriter({ store: recordingStore().store, lockTimeoutMs: 250 });
    const sql = tx();
    writer.record(sql, CREATE);
    await writer.flush(sql);
    let thrown: unknown;
    try {
      writer.record(sql, second);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ kind: 'WRITE_AFTER_FLUSH', reason: 'AUDIT_WRITE_FAILED', status: 500, retryable: false });
    await expect(writer.flush(sql)).rejects.toMatchObject({ kind: 'WRITE_AFTER_FLUSH' });
    // write() is record + flush, so a second write in one transaction is refused the same way (I4 is for one entry)
    await expect(writer.write(sql, second)).rejects.toMatchObject({ kind: 'WRITE_AFTER_FLUSH' });
    expect(sql.marked.map((failure) => (failure as AuditWriteError).kind)).toEqual([
      'WRITE_AFTER_FLUSH',
      'WRITE_AFTER_FLUSH',
      'WRITE_AFTER_FLUSH',
    ]);
  });

  it('[I1] two concurrent flushes of one transaction: the second is refused before the first returns', async () => {
    const writer = createAuditWriter({ store: recordingStore().store, lockTimeoutMs: 250 });
    const sql = tx();
    writer.record(sql, CREATE);
    const [first, again] = await Promise.allSettled([writer.flush(sql), writer.flush(sql)]);
    expect(first.status).toBe('fulfilled');
    expect(again).toMatchObject({ status: 'rejected', reason: { kind: 'WRITE_AFTER_FLUSH' } });
  });

  it('[I3] the first record registers ONE before-commit check: failing while unflushed (UNFLUSHED_ENTRIES), clear after the flush', async () => {
    const writer = createAuditWriter({ store: recordingStore().store, lockTimeoutMs: 250 });
    const sql = tx();
    writer.record(sql, CREATE);
    writer.record(sql, second);
    expect(sql.checks).toHaveLength(1);
    const check = sql.checks[0] as () => Error | undefined;
    expect(check()).toMatchObject({ kind: 'UNFLUSHED_ENTRIES', reason: 'AUDIT_WRITE_FAILED', status: 500 });
    await writer.flush(sql);
    expect(check()).toBeUndefined();
    // a transaction that only flushed (nothing recorded) has nothing to report either
    const empty = tx();
    await writer.flush(empty);
    expect((empty.checks[0] as () => Error | undefined)()).toBeUndefined();
  });

  it('[I4] write = record + flush: one entry, one batch, its own chain position', async () => {
    const { store, batches } = recordingStore();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250 });
    const sql = tx();
    await expect(writer.write(sql, CREATE)).resolves.toBe(APPENDED);
    expect(batches.map((batch) => batch.length)).toEqual([1]);
    expect((sql.checks[0] as () => Error | undefined)()).toBeUndefined();
  });

  it('[STREAM_MISMATCH] a tenant entry of another organisation, or one in an organisation-less transaction, is refused at record', () => {
    const writer = createAuditWriter({ store: recordingStore().store, lockTimeoutMs: 250 });
    const foreign = Object.assign(fakeSql(), { orgId: '019a7c3e-0000-7000-8000-0000000000ff' });
    const none = fakeSql();
    for (const sql of [foreign, none]) {
      expect(() => writer.record(sql, CREATE)).toThrow(expect.objectContaining({ kind: 'STREAM_MISMATCH', status: 500 }));
      expect(sql.marked).toHaveLength(1);
    }
    // the SYSTEM shard (no organisation) is accepted in an organisation-less transaction and in a tenant one
    expect(() => writer.record(none, { ...CREATE, orgId: null })).not.toThrow();
    expect(() => writer.record(tx(), { ...CREATE, orgId: null })).not.toThrow();
    // the comparison ignores the case of the transaction's id (the context statement validates either case)
    expect(() => writer.record(Object.assign(fakeSql(), { orgId: ORG.toUpperCase() }), CREATE)).not.toThrow();
  });

  it('a refused record (invalid entry) is marked and thrown; nothing is buffered', async () => {
    const { store, calls } = recordingStore();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250 });
    const sql = tx();
    expect(() => writer.record(sql, { ...CREATE, outcome: 'OK' as 'SUCCESS' })).toThrow(
      expect.objectContaining({ kind: 'INVALID_ENTRY' }),
    );
    expect(sql.marked).toHaveLength(1);
    await writer.flush(sql);
    expect(calls).toHaveLength(0);
  });

  it('flush runs through the port track (PR42-SEC-13); a refused track starts nothing and is a rejection, not a throw', async () => {
    const { store, calls } = recordingStore();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250 });
    const sql = tx();
    writer.record(sql, CREATE);
    const pending = writer.flush(sql);
    expect(sql.tracked()).toBe(1);
    await pending;
    const closed = Object.assign(tx(), {
      track: (): never => {
        throw new Error('TENANT_TX_CLOSED');
      },
    });
    await expect(writer.flush(closed)).rejects.toThrow('TENANT_TX_CLOSED');
    const odd = Object.assign(tx(), {
      track: (): never => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- TASK-029 a hostile port throwing a non-Error value
        throw 'closed';
      },
    });
    await expect(writer.flush(odd)).rejects.toThrow('closed');
    expect(calls).toHaveLength(1);
  });
});

describe('[PR42-SEC-19 / code review R3-m1] the promises of write and flush are handled; awaiting callers still see the failure', () => {
  async function unhandledDuring(run: () => void): Promise<unknown[]> {
    const seen: unknown[] = [];
    const listener = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      run();
      // two macrotask turns: Node reports an unhandled rejection after the microtask queue of the turn drained
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', listener);
    }
    return seen;
  }

  it('a dropped failing write (success path refusal and a refused track) raises no unhandled rejection', async () => {
    const failing = createAuditWriter({ store: recordingStore(Promise.reject(driverError('55P03'))).store, lockTimeoutMs: 250 });
    const closed = Object.assign(tx(), {
      track: (): never => {
        throw new Error('TENANT_TX_CLOSED');
      },
    });
    const seen = await unhandledDuring(() => {
      // the shapes PR42-SEC-19 names: the result is dropped on purpose
      const dropped = [failing.write(tx(), CREATE), failing.write(closed, CREATE), failing.flush(closed)];
      expect(dropped).toHaveLength(3);
    });
    expect(seen).toEqual([]);
  });

  it('an awaiting caller still receives the rejection, and the transaction is marked', async () => {
    const failing = createAuditWriter({ store: recordingStore(Promise.reject(driverError('55P03'))).store, lockTimeoutMs: 250 });
    const sql = tx();
    await expect(failing.write(sql, CREATE)).rejects.toMatchObject({ reason: 'AUDIT_LOCK_TIMEOUT', status: 503 });
    expect(sql.marked).toHaveLength(1);
  });
});
