import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { type AuditRowDraft, computeEntryHash, ZERO_HASH_HEX } from '../entry-hash.js';
import { AuditWriteError } from '../errors.js';
import { fakeSql, headRow, type RecordedStatement } from '../tests/fake-sql.js';
import { createPrismaAuditStore, type VaultRow } from './prisma-store.js';

const ORG = '019a7c3e-0000-7000-8000-0000000000aa';
const ACTOR = '019a7c3e-0000-7000-8000-0000000000bb';
const ROW: AuditRowDraft = {
  id: '019a7c3e-0000-7000-8000-000000000001',
  streamId: ORG,
  orgId: ORG,
  targetOrgId: null,
  onBehalfOfOrgId: null,
  actorType: 'USER',
  userId: ACTOR,
  apiKeyId: null,
  jobName: null,
  actorRoles: ['Owner'],
  sessionId: null,
  ipToken: null,
  ipHash: null,
  ipHashKeyId: null,
  ipCoarse: '203.0.113.0/24',
  userAgentToken: null,
  uaParsed: null,
  sourceApp: 'web',
  correlationId: 'corr-0001-store',
  action: 'CREATE',
  entityName: 'address',
  entityId: 'a-1',
  outcome: 'SUCCESS',
  reasonToken: null,
  reauthProofId: null,
  signatureMeaning: null,
  httpMethod: 'POST',
  route: '/addresses',
  oldValue: null,
  newValue: { city: 'Pune' },
  details: null,
  piiTokenCount: 0,
  hashVersion: 1,
};
const OPTIONS = { lockTimeoutMs: 250, actorStamp: ACTOR };
const PREV = 'ab'.repeat(32);

const kinds = (statements: readonly RecordedStatement[]): string[] =>
  statements.map((statement) => {
    if (statement.text.includes('FOR UPDATE OF h')) return 'lock';
    if (statement.text.startsWith('INSERT INTO public.audit_stream_heads')) return 'create-head';
    if (statement.text.startsWith('WITH appended AS')) return 'append';
    if (statement.text.startsWith('INSERT INTO public.audit_pii_vault')) return 'vault-insert';
    if (statement.text.includes('WITH ORDINALITY')) return 'vault-lookup';
    return 'other';
  });

describe('[US-088] audit store statement sequence (data-model §5.4 as rewritten, ADR-0007 am. 10 item 1)', () => {
  it('existing stream: lock (with the audit lock_timeout) -> in-process hash -> ONE append-and-advance statement', async () => {
    const sql = fakeSql(headRow(41, PREV, '1763000000123455', '1763000000123000'), 1);
    const appended = await createPrismaAuditStore().append(sql, ROW, OPTIONS);
    expect(kinds(sql.statements)).toEqual(['lock', 'append']);

    const [lock, append] = sql.statements as [RecordedStatement, RecordedStatement];
    expect(lock.kind).toBe('query');
    expect(lock.text).toMatch(/^WITH lt AS MATERIALIZED \(SELECT pg_catalog\.set_config\('lock_timeout', \$1, true\)/);
    expect(lock.values).toEqual(['250', ORG]);
    // monotonic: the clock (…123000) is behind the head (…123455), so occurred_at = head + 1 µs
    const position = { streamSeq: 42, occurredAtMicros: 1_763_000_000_123_456n };
    expect(appended).toEqual({
      id: ROW.id,
      streamId: ORG,
      streamSeq: 42,
      occurredAt: '2025-11-13T02:13:20.123456Z',
      prevHash: PREV,
      entryHash: computeEntryHash(ROW, position, PREV),
    });
    expect(append.kind).toBe('execute');
    expect(append.text).not.toMatch(/RETURNING/i);
    expect(append.text).toContain('UPDATE public.audit_stream_heads');
    expect(append.text).toMatch(/WHERE stream_id = \$\d+::uuid AND entry_count = \$\d+::bigint$/);
    expect(append.values).toContain(41); // entry_count = seq - 1
    expect(append.values).toContain(42);
    expect(append.values).toContain(JSON.stringify({ city: 'Pune' }));
    expect(append.values).toContain(appended.entryHash);
  });

  it('first entry of a stream: lock finds no head -> create it (zero hash in bytea form) -> lock again -> append', async () => {
    const sql = fakeSql([], 1, headRow(0), 1);
    const appended = await createPrismaAuditStore().append(sql, ROW, OPTIONS);
    expect(kinds(sql.statements)).toEqual(['lock', 'create-head', 'lock', 'append']);
    const create = sql.statements[1] as RecordedStatement;
    expect(create.text).toContain("pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')");
    expect(create.text).not.toMatch(/'\\x'/);
    expect(create.text).toContain('ON CONFLICT (stream_id) DO NOTHING');
    expect(create.values).toEqual([ORG, ACTOR, ACTOR]);
    expect(appended).toMatchObject({ streamSeq: 1, prevHash: ZERO_HASH_HEX, occurredAt: '2025-11-13T02:13:20.123456Z' });
  });

  it('an injected hasher computes the entry hash (TASK-030 seam)', async () => {
    const sql = fakeSql(headRow(0), 1);
    const appended = await createPrismaAuditStore({ hash: () => 'cd'.repeat(32) }).append(sql, ROW, OPTIONS);
    expect(appended.entryHash).toBe('cd'.repeat(32));
  });

  it('head moved under the lock (expectAffected(1) mismatch) -> HEAD_MOVED; head still missing -> HEAD_MISSING', async () => {
    await expect(createPrismaAuditStore().append(fakeSql(headRow(3), 0), ROW, OPTIONS)).rejects.toMatchObject({
      kind: 'HEAD_MOVED',
      status: 500,
    });
    await expect(createPrismaAuditStore().append(fakeSql([], 0, []), ROW, OPTIONS)).rejects.toMatchObject({ kind: 'HEAD_MISSING' });
  });

  it.each([
    ['entry_count', [{ entry_count: '-1', head_hash: PREV, head_us: null, now_us: '1' }]],
    ['head_hash', [{ entry_count: '1', head_hash: 'zz', head_us: null, now_us: '1' }]],
    ['now_us', [{ entry_count: '1', head_hash: PREV, head_us: null, now_us: 'x' }]],
    ['head_us', [{ entry_count: '1', head_hash: PREV, head_us: '1.5', now_us: '1' }]],
  ])('an impossible head row (%s) is an integrity failure', async (_field, head) => {
    await expect(createPrismaAuditStore().append(fakeSql(head), ROW, OPTIONS)).rejects.toBeInstanceOf(AuditWriteError);
  });

  it('refuses a lock timeout outside 1..60000 ms before any statement', async () => {
    const sql = fakeSql();
    for (const lockTimeoutMs of [0, 1.5, 60_001]) {
      await expect(createPrismaAuditStore().append(sql, ROW, { ...OPTIONS, lockTimeoutMs })).rejects.toThrow(RangeError);
    }
    expect(sql.statements).toHaveLength(0);
  });

  it('statement errors propagate unchanged (the writer classifies them)', async () => {
    const failure = new Error('driver');
    await expect(createPrismaAuditStore().append(fakeSql(failure), ROW, OPTIONS)).rejects.toBe(failure);
  });
});

describe('[US-087] PII vault batch (ADR-0007 am. 10 item 1: one INSERT + one lookup per entry, never one per value)', () => {
  const SUBJECT = '019a7c3e-0000-7000-8000-0000000000ee';
  const vaultRow = (n: number, overrides: Partial<VaultRow> = {}): VaultRow => ({
    token: `019a7c3e-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`,
    subjectId: SUBJECT,
    classification: 'PERSONAL',
    entityName: 'audit_entry',
    field: n === 1 ? 'ip' : 'user_agent',
    valueHmac: new Uint8Array(32).fill(n),
    valueHmacKeyId: 'vault-hmac-v1',
    ciphertext: new Uint8Array(40).fill(n),
    ciphertextKeyId: 'vault-key-v1',
    ...overrides,
  });

  it('writes the whole batch in one INSERT … unnest … ON CONFLICT DO NOTHING and resolves every token in one lookup', async () => {
    const existing = '019a7c3e-0000-7000-8000-0000000002aa';
    const sql = fakeSql(1, [
      { ord: 2, token: '019a7c3e-0000-7000-8000-000000000102' },
      { ord: 1, token: existing },
    ]);
    const tokens = await createPrismaAuditStore().insertVaultRows(sql, [vaultRow(1), vaultRow(2)], ACTOR);
    expect(tokens).toEqual([existing, '019a7c3e-0000-7000-8000-000000000102']);
    expect(kinds(sql.statements)).toEqual(['vault-insert', 'vault-lookup']);
    const [insert, lookup] = sql.statements as [RecordedStatement, RecordedStatement];
    expect(insert.text).toContain('FROM unnest($');
    expect(insert.text).not.toContain('pg_catalog.unnest');
    expect(insert.text).toContain('ON CONFLICT (subject_id, entity_name, field, value_hmac) DO NOTHING');
    expect(insert.values).toContainEqual(['01'.repeat(32), '02'.repeat(32)]);
    expect(insert.values).toContain('vault-hmac-v1');
    expect(lookup.text).toContain('WITH ORDINALITY');
    expect(lookup.text).toContain('CROSS JOIN LATERAL');
    expect(lookup.text).toContain('LIMIT 1');
  });

  it('an empty batch runs nothing', async () => {
    const sql = fakeSql();
    await expect(createPrismaAuditStore().insertVaultRows(sql, [], ACTOR)).resolves.toEqual([]);
    expect(sql.statements).toHaveLength(0);
  });

  it('mixed key ids, a short HMAC or an unresolved token fail closed as TOKENISER_FAILED', async () => {
    const store = createPrismaAuditStore();
    await expect(
      store.insertVaultRows(fakeSql(), [vaultRow(1), vaultRow(2, { ciphertextKeyId: 'vault-key-v2' })], ACTOR),
    ).rejects.toMatchObject({
      kind: 'TOKENISER_FAILED',
    });
    await expect(store.insertVaultRows(fakeSql(), [vaultRow(1, { valueHmac: new Uint8Array(31) })], ACTOR)).rejects.toMatchObject({
      kind: 'TOKENISER_FAILED',
    });
    await expect(store.insertVaultRows(fakeSql(1, [{ ord: 1, token: 'not-a-uuid' }]), [vaultRow(1)], ACTOR)).rejects.toMatchObject({
      kind: 'TOKENISER_FAILED',
    });
    await expect(store.insertVaultRows(fakeSql(1, [{ ord: 9, token: vaultRow(1).token }]), [vaultRow(1)], ACTOR)).rejects.toMatchObject({
      kind: 'TOKENISER_FAILED',
    });
  });
});

/** packages/audit/src/store/prisma-store.ts, found from the Jest working directory (the repository root or below it). */
function storeSource(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, 'packages', 'audit', 'src', 'store', 'prisma-store.ts');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('prisma-store.ts not found above the working directory');
    dir = parent;
  }
}

describe('store source rules (PR2-SEC-05 / PR11-SEC-05 item 2, D-ARCH-074/103, data-model §5.4 rules)', () => {
  const source = readFileSync(storeSource(), 'utf8');
  const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('constructs no client and imports no Prisma or SQL driver package: only the transaction it is handed', () => {
    const imports = [...code.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(imports.every((specifier) => specifier?.startsWith('../') === true)).toBe(true);
    expect(code).not.toMatch(/new\s+\w*(Client|Pool)\b/);
  });

  it("the file's only setter is the transaction-local audit lock_timeout (the lint exemption covers nothing else)", () => {
    const setters = [...code.matchAll(/set_config\(([^)]*)\)/g)].map((match) => match[1]);
    expect(setters).toEqual(["'lock_timeout', ${lockTimeoutMs}, true"]);
    expect(code).not.toMatch(/app\./);
  });

  it('no RETURNING, no text zero hash, no qualified multi-argument unnest or extract', () => {
    expect(code).not.toMatch(/RETURNING/i);
    expect(code).not.toMatch(/'\\\\x'/);
    expect(code).not.toMatch(/pg_catalog\.(unnest|extract)/);
  });
});
