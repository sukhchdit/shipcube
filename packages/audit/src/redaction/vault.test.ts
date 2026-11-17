/**
 * The PII vault tokeniser and the IP index (ADR-0007 §Privacy erasure and amendment 2; data-model §3.4, §5.7, §10.4
 * amendment SEC-P3-08 item 1; D-ARCH-085; TASK-028), on the fake SQL port: subject resolution, AES-256-GCM with the
 * (table, column, token, key id) AAD, the keyed dedupe HMAC and one vault batch per flush. The database side is
 * apps/api/src/platform/audit/composition.int.test.ts.
 */
import { createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import { ANONYMOUS_ACTOR_ID, SYSTEM_ACTOR_ID } from '@platform/shared';

import { AuditWriteError } from '../errors.js';
import { PiiValue } from '../entry.js';
import { type VaultRow } from '../store/prisma-store.js';
import { fakeSql, type RecordedStatement } from '../tests/fake-sql.js';
import { createIpIndex, createVaultTokeniser, decryptVaultValue, unattributedSubject, type AuditKey } from './vault.js';

const VAULT_KEY: AuditKey = { keyId: 'vault-v1', key: new Uint8Array(randomBytes(32)) };
const HMAC_KEY: AuditKey = { keyId: 'vault-hmac-v1', key: new Uint8Array(randomBytes(32)) };
const USER = '0190c3a4-5b6c-7d8e-9f00-112233445566';
const SUBJECT_ID = '0190c3a4-5b6c-7d8e-9f00-5b0000000001';
const CONTACT = '0190c3a4-5b6c-7d8e-9f00-c00000000001';
const CONTACT_SUBJECT_ID = '0190c3a4-5b6c-7d8e-9f00-5b0000000002';
const ANON_SUBJECT_ID = '0190c3a4-5b6c-7d8e-9f00-5b0000000003';

const value = (field: string, text: string, subject: PiiValue['subject'] = { kind: 'USER', refId: USER }) =>
  new PiiValue({ entityName: 'audit_entry', field, classification: 'PERSONAL', value: text, subject });

let sequence = 0;
const newId = (): string => `0190c3a4-5b6c-7d8e-9f00-${(sequence += 1).toString(16).padStart(12, '0')}`;

/** A store double that captures the vault rows and answers their proposed tokens. */
function capturingStore() {
  const calls: { rows: readonly VaultRow[]; actor: string }[] = [];
  return {
    calls,
    store: {
      insertVaultRows: (_db: unknown, rows: readonly VaultRow[], actor: string) => {
        calls.push({ rows, actor });
        return Promise.resolve(rows.map((row) => row.token));
      },
    },
  };
}

/** The subject lookup answer for `kinds`/`refs` bound in the statement: every ref present in `known`. */
const lookup =
  (known: Readonly<Record<string, string>>) =>
  (statement: RecordedStatement): unknown[] => {
    const [kinds, refs] = statement.values as [string[], string[]];
    return refs.flatMap((ref, index) => {
      const id = known[`${kinds[index] ?? ''}:${ref}`];
      return id === undefined ? [] : [{ ord: index + 1, id }];
    });
  };

describe('[ADR-0007] createVaultTokeniser: one subject lookup, one vault batch, ciphertext bound to its token', () => {
  it('known subjects: one lookup statement, then the vault rows of every value in order', async () => {
    const { calls, store } = capturingStore();
    const tokeniser = createVaultTokeniser({ vaultKey: VAULT_KEY, hmacKey: HMAC_KEY, store, newId });
    const db = fakeSql(lookup({ [`USER:${USER}`]: SUBJECT_ID, [`CONTACT:${CONTACT}`]: CONTACT_SUBJECT_ID }));
    const values = [
      value('ip', '203.0.113.7'),
      value('user_agent', 'Mozilla/5.0'),
      value('name', 'Jane', { kind: 'CONTACT', refId: CONTACT }),
    ];
    const tokens = await tokeniser.tokenise(db, values);

    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]?.text).toMatch(
      /^SELECT k\.ord::integer AS ord, s\.id::text AS id FROM unnest\(\$1::text\[\], \$2::uuid\[\]\) WITH ORDINALITY/,
    );
    // Distinct subjects only.
    expect(db.statements[0]?.values).toEqual([
      ['USER', 'CONTACT'],
      [USER, CONTACT],
    ]);
    const [call] = calls;
    expect(call?.actor).toBe(SYSTEM_ACTOR_ID);
    expect(call?.rows.map((row) => [row.subjectId, row.entityName, row.field, row.classification])).toEqual([
      [SUBJECT_ID, 'audit_entry', 'ip', 'PERSONAL'],
      [SUBJECT_ID, 'audit_entry', 'user_agent', 'PERSONAL'],
      [CONTACT_SUBJECT_ID, 'audit_entry', 'name', 'PERSONAL'],
    ]);
    expect(tokens).toEqual(call?.rows.map((row) => row.token));
  });

  it('each ciphertext decrypts under its own token and key id only (AAD); no plaintext in the row', async () => {
    const { calls, store } = capturingStore();
    const tokeniser = createVaultTokeniser({ vaultKey: VAULT_KEY, hmacKey: HMAC_KEY, store, newId });
    await tokeniser.tokenise(fakeSql(lookup({ [`USER:${USER}`]: SUBJECT_ID })), [value('ip', '203.0.113.7'), value('name', 'Jane Doe')]);
    const [first, second] = calls[0]?.rows ?? [];
    if (first === undefined || second === undefined) throw new Error('two rows expected');
    expect([first.ciphertextKeyId, first.valueHmacKeyId]).toEqual(['vault-v1', 'vault-hmac-v1']);
    expect(decryptVaultValue(VAULT_KEY, first)).toBe('203.0.113.7');
    expect(decryptVaultValue(VAULT_KEY, second)).toBe('Jane Doe');
    // 12-byte nonce + ciphertext + 16-byte tag (ck_audit_pii_vault__ct: 29..65536 bytes).
    expect(first.ciphertext.length).toBe(12 + Buffer.byteLength('203.0.113.7') + 16);
    expect(Buffer.from(first.ciphertext).toString('latin1')).not.toContain('203.0.113.7');
    // T-89: a ciphertext swapped to another token, or read under another key id, fails authentication.
    expect(() => decryptVaultValue(VAULT_KEY, { ...first, token: second.token })).toThrow();
    expect(() => decryptVaultValue(VAULT_KEY, { ...first, ciphertextKeyId: 'vault-v2' })).toThrow();
    expect(() => decryptVaultValue({ keyId: 'vault-v1', key: new Uint8Array(randomBytes(32)) }, first)).toThrow();
  });

  it('the dedupe HMAC is HMAC-SHA256 under the vault HMAC key: equal values share it, the key matters', async () => {
    const { calls, store } = capturingStore();
    const tokeniser = createVaultTokeniser({ vaultKey: VAULT_KEY, hmacKey: HMAC_KEY, store, newId });
    await tokeniser.tokenise(fakeSql(lookup({ [`USER:${USER}`]: SUBJECT_ID })), [value('ip', 'same'), value('ip', 'same')]);
    const rows = calls[0]?.rows ?? [];
    const expected = createHmac('sha256', HMAC_KEY.key).update('same', 'utf8').digest();
    expect(Buffer.from(rows[0]?.valueHmac ?? []).equals(expected)).toBe(true);
    expect(Buffer.from(rows[1]?.valueHmac ?? []).equals(expected)).toBe(true);
    // Fresh nonces: the two ciphertexts of one value differ.
    expect(Buffer.from(rows[0]?.ciphertext ?? []).equals(Buffer.from(rows[1]?.ciphertext ?? []))).toBe(false);
  });

  it('[D-ARCH-149] a value without a known subject belongs to the unattributed subject of its UTC month', async () => {
    const november = 1794913200000; // 2026-11-17T11:00Z
    const anonymousNovember = '01a19467-e800-7000-8000-000000000002';
    expect(unattributedSubject(november)).toEqual({ kind: 'USER', refId: anonymousNovember });
    // The first and the last instant of the month share the subject; December has its own; the tail is the actor id.
    expect(unattributedSubject(Date.UTC(2026, 10, 1)).refId).toBe(anonymousNovember);
    expect(unattributedSubject(Date.UTC(2026, 10, 30, 23, 59, 59, 999)).refId).toBe(anonymousNovember);
    expect(unattributedSubject(Date.UTC(2026, 11, 1)).refId).not.toBe(anonymousNovember);
    expect(unattributedSubject(november).refId.slice(13)).toBe(ANONYMOUS_ACTOR_ID.slice(13));
    const { calls, store } = capturingStore();
    let reads = 0;
    const now = (): number => {
      reads += 1;
      return november;
    };
    const tokeniser = createVaultTokeniser({ vaultKey: VAULT_KEY, hmacKey: HMAC_KEY, store, newId, now });
    const db = fakeSql(lookup({ [`USER:${anonymousNovember}`]: ANON_SUBJECT_ID, [`USER:${USER}`]: SUBJECT_ID }));
    await tokeniser.tokenise(db, [value('filter', 'Pune', null), value('ip', '203.0.113.7', null), value('name', 'Jane')]);
    // One subject for the two unattributed values; a value that names its subject keeps it; the clock is read once.
    expect(db.statements[0]?.values).toEqual([
      ['USER', 'USER'],
      [anonymousNovember, USER],
    ]);
    expect(calls[0]?.rows.map((row) => row.subjectId)).toEqual([ANON_SUBJECT_ID, ANON_SUBJECT_ID, SUBJECT_ID]);
    expect(reads).toBe(1);
  });

  it('a missing subject is inserted (ON CONFLICT DO NOTHING) and looked up again: three statements', async () => {
    const { store } = capturingStore();
    const tokeniser = createVaultTokeniser({ vaultKey: VAULT_KEY, hmacKey: HMAC_KEY, store, newId });
    const db = fakeSql(lookup({}), 1, lookup({ [`USER:${USER}`]: SUBJECT_ID }));
    await tokeniser.tokenise(db, [value('ip', '203.0.113.7')]);
    expect(db.statements.map((statement) => statement.kind)).toEqual(['query', 'execute', 'query']);
    const insert = db.statements[1];
    expect(insert?.text).toMatch(
      /^INSERT INTO public\.data_subjects \(id, kind, ref_id, created_at, updated_at, created_by, updated_by, version\)/,
    );
    expect(insert?.text).toMatch(/ON CONFLICT \(kind, ref_id\) DO NOTHING$/);
    // Only the missing subjects, each with an application-generated id; created_by / updated_by = SYSTEM.
    expect(insert?.values).toEqual([SYSTEM_ACTOR_ID, SYSTEM_ACTOR_ID, [expect.any(String)], ['USER'], [USER]]);
  });

  it('a subject still unresolved after the insert, or a malformed answer, fails as TOKENISER_FAILED', async () => {
    const { store } = capturingStore();
    const tokeniser = createVaultTokeniser({ vaultKey: VAULT_KEY, hmacKey: HMAC_KEY, store, newId });
    const unresolved = tokeniser.tokenise(fakeSql([], 1, []), [value('ip', 'x')]);
    await expect(unresolved).rejects.toMatchObject({ kind: 'TOKENISER_FAILED' });
    const malformed = tokeniser.tokenise(fakeSql([{ ord: 1, id: 'not-a-uuid' }], 1, [{ ord: 9, id: SUBJECT_ID }]), [value('ip', 'x')]);
    await expect(malformed).rejects.toBeInstanceOf(AuditWriteError);
  });

  it('no values: no statement at all', async () => {
    const { calls, store } = capturingStore();
    const db = fakeSql();
    await expect(createVaultTokeniser({ vaultKey: VAULT_KEY, hmacKey: HMAC_KEY, store }).tokenise(db, [])).resolves.toEqual([]);
    expect([db.statements.length, calls.length]).toEqual([0, 0]);
  });

  it('defaults to the Prisma store: the vault INSERT and its token lookup follow the subject lookup', async () => {
    const tokeniser = createVaultTokeniser({ vaultKey: VAULT_KEY, hmacKey: HMAC_KEY, newId });
    const db = fakeSql(lookup({ [`USER:${USER}`]: SUBJECT_ID }), 1, (statement) => {
      const tokens = statement.values;
      return tokens.length > 0 ? [{ ord: 1, token: '0190c3a4-5b6c-7d8e-9f00-7000000000aa' }] : [];
    });
    await expect(tokeniser.tokenise(db, [value('ip', '203.0.113.7')])).resolves.toEqual(['0190c3a4-5b6c-7d8e-9f00-7000000000aa']);
    expect(db.statements[1]?.text).toMatch(/^INSERT INTO public\.audit_pii_vault/);
  });

  it('refuses a malformed key at construction (fail fast, no value in the message)', () => {
    const short = { keyId: 'vault-v1', key: new Uint8Array(16) };
    expect(() => createVaultTokeniser({ vaultKey: short, hmacKey: HMAC_KEY })).toThrow('AUDIT vault key must be 32 bytes');
    expect(() => createVaultTokeniser({ vaultKey: VAULT_KEY, hmacKey: { keyId: 'vault-hmac-v1', key: new Uint8Array(8) } })).toThrow(
      'AUDIT vault HMAC key must be at least 32 bytes',
    );
    expect(() => createVaultTokeniser({ vaultKey: { ...VAULT_KEY, keyId: 'Vault 1' }, hmacKey: HMAC_KEY })).toThrow('key id');
  });
});

describe('[ADR-0007 am. 2] createIpIndex: HMAC-SHA256 under AUDIT_INDEX_KEY', () => {
  const INDEX_KEY: AuditKey = { keyId: 'audit-index-v1', key: new Uint8Array(randomBytes(32)) };

  it('hashes the canonical IP to 32 bytes under its key id', () => {
    const index = createIpIndex(INDEX_KEY);
    expect(index.keyId).toBe('audit-index-v1');
    const digest = index.hash('203.0.113.7');
    expect(digest).toHaveLength(32);
    expect(Buffer.from(digest).equals(createHmac('sha256', INDEX_KEY.key).update('203.0.113.7', 'utf8').digest())).toBe(true);
    expect(Buffer.from(index.hash('203.0.113.8')).equals(Buffer.from(digest))).toBe(false);
  });

  it('refuses a short key or a malformed key id', () => {
    expect(() => createIpIndex({ keyId: 'audit-index-v1', key: new Uint8Array(4) })).toThrow('at least 32 bytes');
    expect(() => createIpIndex({ keyId: 'audit-index', key: INDEX_KEY.key })).toThrow('key id');
  });
});

describe('[PR61 R1-m4] vault format, nonce and key pinned independently of the implementation', () => {
  /** Encrypts two values and returns their rows (fake store). */
  async function twoRows(): Promise<readonly VaultRow[]> {
    const { calls, store } = capturingStore();
    const tokeniser = createVaultTokeniser({ vaultKey: VAULT_KEY, hmacKey: HMAC_KEY, store, newId });
    await tokeniser.tokenise(fakeSql(lookup({ [`USER:${USER}`]: SUBJECT_ID })), [value('ip', 'same'), value('ip', 'same')]);
    return calls[0]?.rows ?? [];
  }

  it('[SEC-TC-49] known-answer AAD: a row decrypts with node:crypto and the literal JCS AAD, and with nothing else', async () => {
    const [row] = await twoRows();
    if (row === undefined) throw new Error('row expected');
    const data = Buffer.from(row.ciphertext);
    const decrypt = (aad: string): string => {
      const decipher = createDecipheriv('aes-256-gcm', VAULT_KEY.key, data.subarray(0, 12), { authTagLength: 16 });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(data.subarray(data.length - 16));
      return Buffer.concat([decipher.update(data.subarray(12, data.length - 16)), decipher.final()]).toString('utf8');
    };
    expect(decrypt(`["audit_pii_vault","ciphertext","${row.token}","vault-v1"]`)).toBe('same');
    expect(() => decrypt(`["audit_pii_vault","ciphertext","${row.token}","vault-v2"]`)).toThrow();
    expect(() => decrypt(`["audit_pii_vault","value","${row.token}","vault-v1"]`)).toThrow();
    expect(() => decrypt(`["audit_pii_vault","ciphertext","${row.token}"]`)).toThrow();
  });

  it('every encryption draws a fresh 96-bit nonce (the first 12 bytes differ)', async () => {
    const [first, second] = await twoRows();
    const nonce = (row: VaultRow | undefined) => Buffer.from(row?.ciphertext ?? []).subarray(0, 12);
    expect(nonce(first)).toHaveLength(12);
    expect(nonce(first).equals(nonce(second))).toBe(false);
  });

  it('an AES key of 33 bytes is refused at construction (exactly 32)', () => {
    expect(() => createVaultTokeniser({ vaultKey: { keyId: 'vault-v1', key: new Uint8Array(33) }, hmacKey: HMAC_KEY })).toThrow(
      'AUDIT vault key must be 32 bytes',
    );
  });
});

describe('[PR61 dup-review R1-m5] missing subjects are inserted in (kind, ref_id) order (no lock-order deadlock)', () => {
  it('sorts the INSERT batch whatever the first-seen order of the values', async () => {
    const { store } = capturingStore();
    const tokeniser = createVaultTokeniser({ vaultKey: VAULT_KEY, hmacKey: HMAC_KEY, store, newId });
    const later = '0190c3a4-5b6c-7d8e-9f00-ffffffffffff';
    const earlier = '0190c3a4-5b6c-7d8e-9f00-000000000aaa';
    const known = { [`USER:${later}`]: SUBJECT_ID, [`USER:${earlier}`]: CONTACT_SUBJECT_ID, [`CONTACT:${CONTACT}`]: ANON_SUBJECT_ID };
    const db = fakeSql(lookup({}), 1, lookup(known));
    await tokeniser.tokenise(db, [
      value('ip', 'a', { kind: 'USER', refId: later }),
      value('ip', 'b', { kind: 'USER', refId: earlier }),
      value('name', 'c', { kind: 'CONTACT', refId: CONTACT }),
    ]);
    const insert = db.statements[1];
    expect(insert?.values.slice(3)).toEqual([
      ['CONTACT', 'USER', 'USER'],
      [CONTACT, earlier, later],
    ]);
  });
});
