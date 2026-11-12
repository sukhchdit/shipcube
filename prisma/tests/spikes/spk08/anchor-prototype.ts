/**
 * SPK-08 anchor prototype (TASK-012; SEC-TC-44; ADR-0007 amendments 7 and 8; data-model.md §3.4, §5.4-§5.6).
 *
 * Throwaway spike code for specialist 12B, consumed only by spk08-anchor.int.test.ts. It is NOT the production
 * implementation (TASK-033 checkpoint/anchor job, TASK-116 verifier); it pins the byte layouts and the verifier logic
 * those tasks implement. The SQL here targets the reduced spike schema created by the test (never a migration).
 *
 * Encodings chosen where the specification is silent are marked "SPK-08 choice" and recorded in the findings.
 */
import { createHash, sign as ecSign, verify as ecVerify, type KeyObject } from 'node:crypto';

import type pg from 'pg';

export const ZERO32: Buffer = Buffer.alloc(32);
export const ALGORITHM = 'ECDSA_P256_SHA256';
/** SYSTEM shard 0 (ADR-0007 amendment 1): the stream that carries the CHAIN_CHECKPOINT entries. */
export const SYSTEM_SHARD_0 = '00000000-0000-0000-0000-000000000000';

/** `YYYY-MM-DDTHH:MM:SS.ffffffZ` rendered by PostgreSQL (JS `Date` has millisecond precision only). */
export const sqlTimestampText = (expr: string): string =>
  `pg_catalog.to_char((${expr}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

const sha256 = (...parts: readonly Buffer[]): Buffer => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
};

/** Big-endian unsigned 64-bit encoding. */
export function be64(value: bigint): Buffer {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new RangeError(`be64 out of range: ${value.toString()}`);
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(value);
  return out;
}

/** The 16 raw bytes of a canonical (hyphenated, any case) UUID. */
export function uuidBytes(uuid: string): Buffer {
  const hex = uuid.replaceAll('-', '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new TypeError('not a UUID');
  return Buffer.from(hex, 'hex');
}

// ---------------------------------------------------------------------------------------------------------------
// Entry hashing (reduced canonical object; production uses RFC 8785 via `canonicalize`, data-model §5.4 step 4)
// ---------------------------------------------------------------------------------------------------------------

export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

/** RFC 8785 for the subset used here (strings, safe integers, booleans, null, arrays, objects). */
export function canonicalJson(value: Json): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('the spike canonicaliser accepts safe integers only');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${(value as readonly Json[]).map(canonicalJson).join(',')}]`;
  const object = value as { readonly [key: string]: Json };
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key] ?? null)}`).join(',')}}`;
}

/** The hashed columns of the reduced spike `audit_entries` table. */
export interface EntryContent {
  readonly id: string;
  readonly occurredAt: string;
  readonly streamId: string;
  readonly streamSeq: bigint;
  readonly action: string;
  readonly entityName: string;
  readonly entityId: string | null;
  readonly newValue: Json;
  readonly hashVersion: number;
}

/** `entry_hash = SHA-256(UTF-8(JCS(canonical)) ‖ prev_hash)` (data-model §5.4 step 4). */
export function entryHash(entry: EntryContent, prevHash: Buffer): Buffer {
  const canonical: Json = {
    id: entry.id,
    occurred_at: entry.occurredAt,
    stream_id: entry.streamId,
    stream_seq: Number(entry.streamSeq),
    action: entry.action,
    entity_name: entry.entityName,
    entity_id: entry.entityId,
    new_value: entry.newValue,
    hash_version: entry.hashVersion,
  };
  return sha256(Buffer.from(canonicalJson(canonical), 'utf8'), prevHash);
}

// ---------------------------------------------------------------------------------------------------------------
// Heads digest and anchor hash (data-model §3.4, §5.5)
// ---------------------------------------------------------------------------------------------------------------

export interface StreamHead {
  readonly streamId: string;
  readonly entryCount: bigint;
  readonly headHash: Buffer;
  /** Locator only; not part of the digest. */
  readonly headOccurredAt: string | null;
}

/**
 * `heads_digest = SHA-256( ‖ over heads sorted by stream_id of stream_id(16 B) ‖ be64(entry_count) ‖ head_hash(32 B) )`.
 * SPK-08 choice: "sorted by stream_id" means ascending by the 16 raw bytes, which equals PostgreSQL's `uuid` order and
 * the order of lower-case hex text. An empty head set digests to SHA-256 of the empty string.
 */
export function headsDigest(heads: readonly StreamHead[]): Buffer {
  const sorted = [...heads].sort((a, b) => Buffer.compare(uuidBytes(a.streamId), uuidBytes(b.streamId)));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i - 1]?.streamId.toLowerCase() === sorted[i]?.streamId.toLowerCase()) throw new Error('duplicate stream in head set');
  }
  return sha256(...sorted.flatMap((head) => [uuidBytes(head.streamId), be64(head.entryCount), head.headHash]));
}

export interface AnchorHashInput {
  readonly anchorSeq: bigint;
  /** `YYYY-MM-DDTHH:MM:SS.ffffffZ` (UTC, microseconds). */
  readonly createdAt: string;
  readonly headsDigest: Buffer;
  readonly prevAnchorHash: Buffer;
}

/** `anchor_hash = SHA-256(be64(anchor_seq) ‖ UTF-8(created_at) ‖ heads_digest ‖ prev_anchor_hash)` (data-model §3.4). */
export function anchorHash(input: AnchorHashInput): Buffer {
  if (!TIMESTAMP_TEXT.test(input.createdAt)) throw new TypeError('created_at must be YYYY-MM-DDTHH:MM:SS.ffffffZ');
  if (input.headsDigest.length !== 32 || input.prevAnchorHash.length !== 32) throw new TypeError('digests must be 32 bytes');
  return sha256(be64(input.anchorSeq), Buffer.from(input.createdAt, 'utf8'), input.headsDigest, input.prevAnchorHash);
}

/** ECDSA P-256 over SHA-256(message = anchor_hash), DER-encoded (Node's default `dsaEncoding`; what openssl verifies). */
export function signAnchorHash(hash: Buffer, privateKey: KeyObject): Buffer {
  return ecSign('sha256', hash, { key: privateKey, dsaEncoding: 'der' });
}

export function verifyAnchorSignature(hash: Buffer, signature: Buffer, publicKeyPem: string): boolean {
  return ecVerify('sha256', hash, { key: publicKeyPem, dsaEncoding: 'der' }, signature);
}

/**
 * DER `SEQUENCE { INTEGER r, INTEGER s }` → IEEE P1363 `r ‖ s` (2 × 32 bytes). WebCrypto `ECDSA` verifies only P1363,
 * so an in-browser verifier (ADR-0007 am. 8 item 5) needs this conversion of the stored DER signature.
 */
export function derToP1363(der: Buffer, size = 32): Buffer {
  let offset = 0;
  const byte = (): number => {
    const value = der[offset];
    if (value === undefined) throw new TypeError('truncated DER signature');
    offset += 1;
    return value;
  };
  if (byte() !== 0x30) throw new TypeError('DER signature must start with SEQUENCE');
  const total = byte();
  if (total & 0x80 || total !== der.length - 2) throw new TypeError('unexpected DER length');
  const integer = (): Buffer => {
    if (byte() !== 0x02) throw new TypeError('DER INTEGER expected');
    const length = byte();
    let value = der.subarray(offset, offset + length);
    offset += length;
    while (value.length > size && value[0] === 0) value = value.subarray(1);
    if (value.length > size || value.length === 0) throw new TypeError('DER INTEGER out of range');
    return Buffer.concat([Buffer.alloc(size - value.length), value]);
  };
  const r = integer();
  const s = integer();
  if (offset !== der.length) throw new TypeError('trailing bytes after DER signature');
  return Buffer.concat([r, s]);
}

// ---------------------------------------------------------------------------------------------------------------
// Anchor records: table row <-> sink line
// ---------------------------------------------------------------------------------------------------------------

export interface AnchorRecord {
  readonly anchorSeq: bigint;
  readonly checkpointEntryId: string;
  readonly createdAt: string;
  readonly headsDigest: Buffer;
  readonly prevAnchorHash: Buffer;
  readonly anchorHash: Buffer;
  readonly algorithm: string;
  readonly keyId: string;
  readonly signature: Buffer;
}

/**
 * Sink line (data-model §5.5 "Sink record"): every column, bytea as lower-case hex, signature as base64, created_at in
 * the hashed text form. SPK-08 choice: the line is the RFC 8785 (JCS) serialisation, `anchor_seq` a JSON number, so
 * "byte-identical" has one meaning for every writer and reader.
 */
export function sinkLine(record: AnchorRecord): string {
  return canonicalJson({
    anchor_seq: Number(record.anchorSeq),
    checkpoint_entry_id: record.checkpointEntryId.toLowerCase(),
    created_at: record.createdAt,
    heads_digest: record.headsDigest.toString('hex'),
    prev_anchor_hash: record.prevAnchorHash.toString('hex'),
    anchor_hash: record.anchorHash.toString('hex'),
    algorithm: record.algorithm,
    key_id: record.keyId,
    signature: record.signature.toString('base64'),
  });
}

const HEX32 = /^[0-9a-f]{64}$/;

/** Parses one sink line; returns undefined for anything that is not a well-formed record. */
export function parseSinkLine(line: string): AnchorRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const r = parsed as Record<string, unknown>;
  const { anchor_seq: seq, checkpoint_entry_id: cp, created_at: at, heads_digest: hd, prev_anchor_hash: prev } = r;
  const { anchor_hash: ah, algorithm, key_id: keyId, signature } = r;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) return undefined;
  if (typeof cp !== 'string' || typeof at !== 'string' || typeof algorithm !== 'string' || typeof keyId !== 'string') return undefined;
  if (typeof hd !== 'string' || typeof prev !== 'string' || typeof ah !== 'string' || typeof signature !== 'string') return undefined;
  if (!HEX32.test(hd) || !HEX32.test(prev) || !HEX32.test(ah)) return undefined;
  return {
    anchorSeq: BigInt(seq),
    checkpointEntryId: cp,
    createdAt: at,
    headsDigest: Buffer.from(hd, 'hex'),
    prevAnchorHash: Buffer.from(prev, 'hex'),
    anchorHash: Buffer.from(ah, 'hex'),
    algorithm,
    keyId,
    signature: Buffer.from(signature, 'base64'),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Verifier steps (i) and (ii) (data-model §5.6 amendment) — pure
// ---------------------------------------------------------------------------------------------------------------

export type FailureKind =
  | 'HASH_MISMATCH'
  | 'PREV_HASH_MISMATCH'
  | 'SEQ_GAP'
  | 'HEAD_MISMATCH'
  | 'CHECKPOINT_HEAD_MISMATCH'
  | 'CHECKPOINT_SIGNATURE_INVALID'
  | 'ANCHOR_MISSING';

export interface Failure {
  readonly kind: FailureKind;
  readonly step: 'chain' | 'i' | 'ii' | 'iii-a' | 'iii-b';
  readonly detail: string;
  readonly anchorSeq?: bigint;
  readonly streamId?: string;
}

export interface AnchorLogInput {
  readonly tableRows: readonly AnchorRecord[];
  /** Raw sink lines in file order (blank lines ignored). */
  readonly sinkLines: readonly string[];
  /** First `anchor_seq` of the range under check, and the `anchor_hash` it must chain to (32 zero bytes for seq 1). */
  readonly fromSeq: bigint;
  readonly expectedPrevHash: Buffer;
  /** True while the writer's sink retry (<= 15 min) may still be running: the newest table anchor may be absent. */
  readonly sinkRetryWindowOpen: boolean;
}

function checkLog(label: string, rows: readonly AnchorRecord[], fromSeq: bigint, expectedPrev: Buffer): Failure[] {
  const failures: Failure[] = [];
  let expectedSeq = fromSeq;
  let prev = expectedPrev;
  for (const row of rows) {
    if (row.anchorSeq !== expectedSeq) {
      failures.push({
        kind: 'ANCHOR_MISSING',
        step: 'i',
        anchorSeq: row.anchorSeq,
        detail: `${label}: expected anchor_seq ${expectedSeq.toString()}, found ${row.anchorSeq.toString()}`,
      });
    } else if (!row.prevAnchorHash.equals(prev)) {
      failures.push({ kind: 'ANCHOR_MISSING', step: 'i', anchorSeq: row.anchorSeq, detail: `${label}: prev_anchor_hash does not chain` });
    }
    expectedSeq = row.anchorSeq + 1n;
    prev = row.anchorHash;
  }
  return failures;
}

/** Step (i): each log dense, in order and chained; table and sink byte-identical per anchor_seq. */
export function verifyAnchorLog(input: AnchorLogInput): Failure[] {
  const failures: Failure[] = [];
  const sink: AnchorRecord[] = [];
  const sinkText = new Map<bigint, string>();
  for (const line of input.sinkLines) {
    if (line.trim() === '') continue;
    const record = parseSinkLine(line);
    if (record === undefined) {
      failures.push({ kind: 'ANCHOR_MISSING', step: 'i', detail: 'sink: malformed record' });
      continue;
    }
    if (record.anchorSeq < input.fromSeq) continue;
    const seen = sinkText.get(record.anchorSeq);
    if (seen === line) continue; // byte-identical duplicate of a retried write: one record
    if (seen !== undefined) {
      failures.push({ kind: 'ANCHOR_MISSING', step: 'i', anchorSeq: record.anchorSeq, detail: 'sink: differing duplicate' });
      continue;
    }
    sinkText.set(record.anchorSeq, line);
    sink.push(record);
  }
  const table = input.tableRows.filter((row) => row.anchorSeq >= input.fromSeq);
  failures.push(...checkLog('table', table, input.fromSeq, input.expectedPrevHash));
  failures.push(...checkLog('sink', sink, input.fromSeq, input.expectedPrevHash));

  const tableText = new Map(table.map((row) => [row.anchorSeq, sinkLine(row)] as const));
  const newestTableSeq = table.reduce((max, row) => (row.anchorSeq > max ? row.anchorSeq : max), 0n);
  for (const [seq, text] of tableText) {
    const other = sinkText.get(seq);
    if (other === undefined) {
      if (!(input.sinkRetryWindowOpen && seq === newestTableSeq)) {
        failures.push({ kind: 'ANCHOR_MISSING', step: 'i', anchorSeq: seq, detail: 'table anchor absent from the sink' });
      }
    } else if (other !== text) {
      failures.push({ kind: 'ANCHOR_MISSING', step: 'i', anchorSeq: seq, detail: 'table and sink records differ' });
    }
  }
  for (const seq of sinkText.keys()) {
    if (!tableText.has(seq))
      failures.push({ kind: 'ANCHOR_MISSING', step: 'i', anchorSeq: seq, detail: 'sink anchor absent from the table' });
  }
  return failures;
}

/** Step (ii): recompute anchor_hash, then verify the signature with the public key registered for key_id. */
export function verifyAnchorSignatures(rows: readonly AnchorRecord[], publicKeys: ReadonlyMap<string, string>): Failure[] {
  const failures: Failure[] = [];
  for (const row of rows) {
    const fail = (detail: string): void => {
      failures.push({ kind: 'CHECKPOINT_SIGNATURE_INVALID', step: 'ii', anchorSeq: row.anchorSeq, detail });
    };
    if (row.algorithm !== ALGORITHM) {
      fail(`unsupported algorithm ${row.algorithm}`);
      continue;
    }
    let recomputed: Buffer;
    try {
      recomputed = anchorHash(row);
    } catch (error) {
      fail(`anchor_hash not recomputable: ${(error as Error).message}`);
      continue;
    }
    if (!recomputed.equals(row.anchorHash)) {
      fail('recomputed anchor_hash differs from the stored value');
      continue;
    }
    const pem = publicKeys.get(row.keyId);
    if (pem === undefined) {
      fail(`unknown key_id ${row.keyId}`);
      continue;
    }
    if (!verifyAnchorSignature(row.anchorHash, row.signature, pem)) fail('signature does not verify');
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------------------
// DB access for the spike schema
// ---------------------------------------------------------------------------------------------------------------

interface AnchorRow {
  anchor_seq: string;
  checkpoint_entry_id: string;
  created_at: string;
  heads_digest: Buffer;
  prev_anchor_hash: Buffer;
  anchor_hash: Buffer;
  algorithm: string;
  key_id: string;
  signature: Buffer;
}

export async function readAnchors(client: pg.ClientBase, fromSeq = 1n): Promise<AnchorRecord[]> {
  const { rows } = await client.query<AnchorRow>(
    `SELECT anchor_seq::text AS anchor_seq, checkpoint_entry_id::text AS checkpoint_entry_id,
            ${sqlTimestampText('created_at')} AS created_at, heads_digest, prev_anchor_hash, anchor_hash, algorithm, key_id, signature
       FROM public.audit_anchors a WHERE a.anchor_seq >= $1 ORDER BY a.anchor_seq`, // qualified: the bare name would sort by the ::text alias
    [fromSeq.toString()],
  );
  return rows.map((row) => ({
    anchorSeq: BigInt(row.anchor_seq),
    checkpointEntryId: row.checkpoint_entry_id,
    createdAt: row.created_at,
    headsDigest: row.heads_digest,
    prevAnchorHash: row.prev_anchor_hash,
    anchorHash: row.anchor_hash,
    algorithm: row.algorithm,
    keyId: row.key_id,
    signature: row.signature,
  }));
}

interface EntryRow {
  id: string;
  occurred_at: string;
  stream_id: string;
  stream_seq: string;
  action: string;
  entity_name: string;
  entity_id: string | null;
  new_value: Json;
  hash_version: number;
  prev_hash: Buffer;
  entry_hash: Buffer;
}

export interface StoredEntry extends EntryContent {
  readonly prevHash: Buffer;
  readonly entryHash: Buffer;
}

export async function readStream(client: pg.ClientBase, streamId: string): Promise<StoredEntry[]> {
  const { rows } = await client.query<EntryRow>(
    `SELECT id::text AS id, ${sqlTimestampText('occurred_at')} AS occurred_at, stream_id::text AS stream_id,
            stream_seq::text AS stream_seq, action, entity_name, entity_id, new_value, hash_version, prev_hash, entry_hash
       FROM public.audit_entries e WHERE e.stream_id = $1 ORDER BY e.stream_seq`,
    [streamId],
  );
  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    streamId: row.stream_id,
    streamSeq: BigInt(row.stream_seq),
    action: row.action,
    entityName: row.entity_name,
    entityId: row.entity_id,
    newValue: row.new_value,
    hashVersion: row.hash_version,
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
  }));
}

interface HeadRow {
  stream_id: string;
  entry_count: string;
  head_hash: Buffer;
  head_occurred_at: string | null;
}

const toHead = (row: HeadRow): StreamHead => ({
  streamId: row.stream_id,
  entryCount: BigInt(row.entry_count),
  headHash: row.head_hash,
  headOccurredAt: row.head_occurred_at,
});

/** ONE snapshot of every stream head (single statement), sorted by stream_id (data-model §5.5). */
export async function snapshotHeads(client: pg.ClientBase): Promise<StreamHead[]> {
  const { rows } = await client.query<HeadRow>(
    `SELECT stream_id::text AS stream_id, entry_count::text AS entry_count, head_hash,
            ${sqlTimestampText('head_occurred_at')} AS head_occurred_at
       FROM public.audit_stream_heads h ORDER BY h.stream_id`,
  );
  return rows.map(toHead);
}

/** Full head set of checkpoint k: the latest delta row per stream at or before k (data-model §3.4 amendment). */
export async function reconstructHeads(client: pg.ClientBase, checkpointEntryId: string): Promise<StreamHead[]> {
  const { rows } = await client.query<HeadRow>(
    `SELECT DISTINCT ON (c.stream_id) c.stream_id::text AS stream_id, c.entry_count::text AS entry_count, c.head_hash,
            ${sqlTimestampText('c.head_occurred_at')} AS head_occurred_at
       FROM public.audit_checkpoint_heads c
      WHERE c.checkpoint_entry_id <= $1
      ORDER BY c.stream_id, c.checkpoint_entry_id DESC`,
    [checkpointEntryId],
  );
  return rows.map(toHead);
}

/** Chain walk of one stream (data-model §5.6), from seq 1; compares the result with the stored head. */
export async function verifyStreamChain(client: pg.ClientBase, streamId: string): Promise<Failure[]> {
  const entries = await readStream(client, streamId);
  const failures: Failure[] = [];
  let running = ZERO32;
  let expected = 1n;
  for (const entry of entries) {
    if (entry.streamSeq !== expected) {
      failures.push({ kind: 'SEQ_GAP', step: 'chain', streamId, detail: `expected seq ${expected.toString()}` });
      break;
    }
    if (!entry.prevHash.equals(running)) {
      failures.push({ kind: 'PREV_HASH_MISMATCH', step: 'chain', streamId, detail: `seq ${entry.streamSeq.toString()}` });
      break;
    }
    if (!entryHash(entry, entry.prevHash).equals(entry.entryHash)) {
      failures.push({ kind: 'HASH_MISMATCH', step: 'chain', streamId, detail: `seq ${entry.streamSeq.toString()}` });
      break;
    }
    running = entry.entryHash;
    expected += 1n;
  }
  if (failures.length === 0) {
    const { rows } = await client.query<{ head_hash: Buffer }>('SELECT head_hash FROM public.audit_stream_heads WHERE stream_id = $1', [
      streamId,
    ]);
    const head = rows[0]?.head_hash ?? ZERO32;
    if (!head.equals(running))
      failures.push({ kind: 'HEAD_MISMATCH', step: 'chain', streamId, detail: 'stored head differs from the walk' });
  }
  return failures;
}

/** Step (iii) for one anchor: (a) reconstructed digest vs anchor and checkpoint entry; (b) every anchored head probe. */
export async function verifyAnchoredHeads(client: pg.ClientBase, anchor: AnchorRecord): Promise<Failure[]> {
  const failures: Failure[] = [];
  const heads = await reconstructHeads(client, anchor.checkpointEntryId);
  const digest = headsDigest(heads);
  if (!digest.equals(anchor.headsDigest)) {
    failures.push({
      kind: 'CHECKPOINT_HEAD_MISMATCH',
      step: 'iii-a',
      anchorSeq: anchor.anchorSeq,
      detail: 'reconstructed heads_digest differs from the anchor',
    });
  }
  const checkpoint = await client.query<{ digest: string | null }>(
    `SELECT new_value->>'heads_digest' AS digest FROM public.audit_entries WHERE stream_id = $1 AND id = $2`,
    [SYSTEM_SHARD_0, anchor.checkpointEntryId],
  );
  const entryDigest = checkpoint.rows[0]?.digest;
  if (entryDigest !== digest.toString('hex')) {
    failures.push({
      kind: 'CHECKPOINT_HEAD_MISMATCH',
      step: 'iii-a',
      anchorSeq: anchor.anchorSeq,
      detail: 'checkpoint entry new_value.heads_digest differs',
    });
  }
  // (b) one probe per stream, batched in one statement: exact (occurred_at, stream_id, stream_seq) of each anchored head
  const { rows } = await client.query<{ stream_id: string; anchored: Buffer; actual: Buffer | null }>(
    `SELECT h.stream_id::text AS stream_id, h.head_hash AS anchored, e.entry_hash AS actual
       FROM unnest($1::uuid[], $2::bigint[], $3::bytea[], $4::timestamptz[]) AS h(stream_id, entry_count, head_hash, head_occurred_at)
       LEFT JOIN public.audit_entries e
         ON e.stream_id = h.stream_id AND e.stream_seq = h.entry_count AND e.occurred_at = h.head_occurred_at
      ORDER BY h.stream_id`,
    [
      heads.map((h) => h.streamId),
      heads.map((h) => h.entryCount.toString()),
      heads.map((h) => h.headHash),
      heads.map((h) => h.headOccurredAt),
    ],
  );
  for (const row of rows) {
    if (row.actual === null || !row.actual.equals(row.anchored)) {
      failures.push({
        kind: 'CHECKPOINT_HEAD_MISMATCH',
        step: 'iii-b',
        anchorSeq: anchor.anchorSeq,
        streamId: row.stream_id,
        detail: 'entry at the anchored head differs',
      });
    }
  }
  return failures;
}
