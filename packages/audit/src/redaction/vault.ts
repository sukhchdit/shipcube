/**
 * The audit PII tokeniser and the IP index (ADR-0007 §Privacy erasure and amendment 2; data-model §3.4 `ip_hash`,
 * §5.7, §10.4 amendment SEC-P3-08 item 1; D-ARCH-085; TASK-028). Runs inside the business transaction, before the
 * stream lock (the writer's flush): no external I/O (T-83).
 *
 * One flush tokenises every personal value of every recorded entry in ONE call:
 *  1. subjects: one lookup of the distinct data subjects (`data_subjects`, insert-only); only when one is missing,
 *     one `INSERT … ON CONFLICT (kind, ref_id) DO NOTHING` for the missing ones and the lookup again (a concurrent
 *     inserter's row is visible to the new statement's snapshot);
 *  2. the vault rows of all values: token = a proposed UUIDv7; `value_hmac` = HMAC-SHA256(`AUDIT_VAULT_HMAC_KEY`,
 *     UTF-8 value), the dedupe key, so a repeated value of the same subject, entity and field keeps its token;
 *     `ciphertext` = AES-256-GCM(`AUDIT_VAULT_KEY`, 96-bit random nonce) as `nonce ‖ ct ‖ tag` with
 *     AAD = UTF-8(JCS(["audit_pii_vault", "ciphertext", token, ciphertext_key_id])), so a ciphertext copied to another
 *     row or read under another key version fails authentication (T-89);
 *  3. `AuditStore.insertVaultRows`: one multi-row INSERT and one token lookup (prisma-store.ts statements 1, 1b).
 * A value whose subject is unknown (an anonymous client's IP, a list filter) belongs to the UNATTRIBUTED subject, the
 * reserved ANONYMOUS actor (data-model §1.6; D-TASK028-04): `subject_id` is NOT NULL, and such values have no person
 * to erase them for; retention removes them.
 *
 * Vault rows and subjects are stamped `created_by = updated_by =` the SYSTEM actor: the platform writes them, on
 * behalf of whichever entry carries the value.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import { ANONYMOUS_ACTOR_ID, SYSTEM_ACTOR_ID, uuidv7 } from '@platform/shared';

import type { DataSubjectRef, IpIndex, PiiValue } from '../entry.js';
import { jcs } from '../entry-hash.js';
import { AuditWriteError } from '../errors.js';
import { type AuditSqlPort, type AuditStore, createPrismaAuditStore, type VaultRow } from '../store/prisma-store.js';
import type { PiiTokeniser } from '../writer.js';

/** One version of a symmetric key: its `<purpose>-v<n>` id and its bytes (already derived, see keys.ts). */
export interface AuditKey {
  readonly keyId: string;
  readonly key: Uint8Array;
}

/** Owner of a personal value without a known person (data-model §1.6 ANONYMOUS actor; D-TASK028-04). */
export const UNATTRIBUTED_SUBJECT: DataSubjectRef = Object.freeze({ kind: 'USER', refId: ANONYMOUS_ACTOR_ID });

const KEY_ID = /^[a-z][a-z0-9-]*-v[0-9]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AES_KEY_BYTES = 32;
const MIN_HMAC_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function checkKey(key: AuditKey, what: string, bytes: number, exact: boolean): void {
  if (typeof key.keyId !== 'string' || !KEY_ID.test(key.keyId)) throw new RangeError(`${what} key id must be <purpose>-v<n>`);
  const size = key.key.length;
  if (exact ? size !== bytes : size < bytes) throw new RangeError(`${what} key must be ${exact ? '' : 'at least '}${String(bytes)} bytes`);
}

const hmac = (key: AuditKey, value: string): Uint8Array => new Uint8Array(createHmac('sha256', key.key).update(value, 'utf8').digest());

/** AAD of a vault ciphertext (data-model §10.4 amendment): JCS of [table, column, row reference, key id]. */
const vaultAad = (token: string, keyId: string): Buffer =>
  Buffer.from(jcs(['audit_pii_vault', 'ciphertext', token.toLowerCase(), keyId]), 'utf8');

function encrypt(key: AuditKey, token: string, value: string): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key.key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(vaultAad(token, key.keyId));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return new Uint8Array(Buffer.concat([nonce, body, cipher.getAuthTag()]));
}

/**
 * The plaintext of a vault row (the viewer's token resolution, TASK-031/060; integration tests). Throws when the
 * ciphertext does not authenticate under `key` for this token and key id.
 */
export function decryptVaultValue(key: AuditKey, row: Pick<VaultRow, 'token' | 'ciphertext' | 'ciphertextKeyId'>): string {
  if (row.ciphertextKeyId !== key.keyId) throw new RangeError('vault row was encrypted under another key version');
  const data = Buffer.from(row.ciphertext);
  if (data.length < NONCE_BYTES + TAG_BYTES + 1) throw new RangeError('vault ciphertext is too short');
  const decipher = createDecipheriv('aes-256-gcm', key.key, data.subarray(0, NONCE_BYTES), { authTagLength: TAG_BYTES });
  decipher.setAAD(vaultAad(row.token, row.ciphertextKeyId));
  decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
  return Buffer.concat([decipher.update(data.subarray(NONCE_BYTES, data.length - TAG_BYTES)), decipher.final()]).toString('utf8');
}

const subjectKey = (subject: DataSubjectRef): string => `${subject.kind}:${subject.refId.toLowerCase()}`;

/** `data_subjects.id` of each subject (index-aligned), or undefined where the table has none yet. */
async function lookupSubjects(db: AuditSqlPort, subjects: readonly DataSubjectRef[]): Promise<(string | undefined)[]> {
  const kinds = subjects.map((subject) => subject.kind);
  const refs = subjects.map((subject) => subject.refId.toLowerCase());
  const found = await db.$queryRaw<Array<{ ord: number; id: string }>>`SELECT k.ord::integer AS ord, s.id::text AS id
  FROM unnest(${kinds}::text[], ${refs}::uuid[]) WITH ORDINALITY AS k(kind, ref_id, ord)
  JOIN public.data_subjects s ON s.kind = k.kind AND s.ref_id = k.ref_id`;
  const ids = new Array<string | undefined>(subjects.length).fill(undefined);
  for (const { ord, id } of found) {
    const index = Number(ord) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= subjects.length || typeof id !== 'string' || !UUID.test(id)) {
      throw new AuditWriteError('TOKENISER_FAILED');
    }
    ids[index] = id.toLowerCase();
  }
  return ids;
}

/** Inserts the missing subjects (insert-only table; a concurrent insert of the same subject is not an error). */
async function insertSubjects(db: AuditSqlPort, subjects: readonly DataSubjectRef[], newId: () => string): Promise<void> {
  const ids = subjects.map(() => newId());
  const kinds = subjects.map((subject) => subject.kind);
  const refs = subjects.map((subject) => subject.refId.toLowerCase());
  await db.$executeRaw`INSERT INTO public.data_subjects (id, kind, ref_id, created_at, updated_at, created_by, updated_by, version)
SELECT t.id, t.kind, t.ref_id, pg_catalog.now(), pg_catalog.now(), ${SYSTEM_ACTOR_ID}::uuid, ${SYSTEM_ACTOR_ID}::uuid, 1
  FROM unnest(${ids}::uuid[], ${kinds}::text[], ${refs}::uuid[]) AS t(id, kind, ref_id)
ON CONFLICT (kind, ref_id) DO NOTHING`;
}

/** Subject key -> `data_subjects.id` for every distinct subject of the batch. */
async function resolveSubjects(db: AuditSqlPort, subjects: readonly DataSubjectRef[], newId: () => string): Promise<Map<string, string>> {
  let ids = await lookupSubjects(db, subjects);
  // Inserted in (kind, ref_id) order (PR #61 dup-review R1-m5): an ON CONFLICT insert waits for a concurrent inserter of
  // the same key, so two transactions creating the same subjects in opposite orders would deadlock.
  const missing = subjects.filter((_subject, index) => ids[index] === undefined).sort((a, b) => (subjectKey(a) < subjectKey(b) ? -1 : 1));
  if (missing.length > 0) {
    await insertSubjects(db, missing, newId);
    ids = await lookupSubjects(db, subjects);
  }
  const resolved = new Map<string, string>();
  subjects.forEach((subject, index) => {
    const id = ids[index];
    if (id === undefined) throw new AuditWriteError('TOKENISER_FAILED');
    resolved.set(subjectKey(subject), id);
  });
  return resolved;
}

export interface VaultTokeniserOptions {
  /** `AUDIT_VAULT_KEY` (AES-256-GCM, 32 bytes). */
  readonly vaultKey: AuditKey;
  /** `AUDIT_VAULT_HMAC_KEY` (HMAC-SHA256 dedupe index, ≥ 32 bytes; never the vault key, ADR-0018 register). */
  readonly hmacKey: AuditKey;
  /** Defaults to the Prisma store (statements 1 and 1b of data-model §5.4). */
  readonly store?: Pick<AuditStore, 'insertVaultRows'>;
  /** UUIDv7 factory for proposed tokens and subject ids; injectable for tests. */
  readonly newId?: () => string;
}

/** The writer's `PiiTokeniser` over the encrypted vault (see the header). */
export function createVaultTokeniser(options: VaultTokeniserOptions): PiiTokeniser {
  checkKey(options.vaultKey, 'AUDIT vault', AES_KEY_BYTES, true);
  checkKey(options.hmacKey, 'AUDIT vault HMAC', MIN_HMAC_KEY_BYTES, false);
  const store = options.store ?? createPrismaAuditStore();
  const newId = options.newId ?? uuidv7;
  const { vaultKey, hmacKey } = options;

  async function tokenise(db: AuditSqlPort, values: readonly PiiValue[]): Promise<readonly string[]> {
    if (values.length === 0) return [];
    const owners = values.map((value) => value.subject ?? UNATTRIBUTED_SUBJECT);
    const distinct = [...new Map(owners.map((subject) => [subjectKey(subject), subject])).values()];
    const subjectIds = await resolveSubjects(db, distinct, newId);
    const rows: VaultRow[] = values.map((value, index) => {
      const token = newId();
      return {
        token,
        subjectId: subjectIds.get(subjectKey(owners[index] as DataSubjectRef)) as string,
        classification: value.classification,
        entityName: value.entityName,
        field: value.field,
        valueHmac: hmac(hmacKey, value.value),
        valueHmacKeyId: hmacKey.keyId,
        ciphertext: encrypt(vaultKey, token, value.value),
        ciphertextKeyId: vaultKey.keyId,
      };
    });
    return store.insertVaultRows(db, rows, SYSTEM_ACTOR_ID);
  }

  return { tokenise };
}

/** `ip_hash` = HMAC-SHA256(`AUDIT_INDEX_KEY`, canonical IP) with its key id (ADR-0007 amendment 2). */
export function createIpIndex(indexKey: AuditKey): IpIndex {
  checkKey(indexKey, 'AUDIT index', MIN_HMAC_KEY_BYTES, false);
  return Object.freeze({ keyId: indexKey.keyId, hash: (ip: string): Uint8Array => hmac(indexKey, ip) });
}
