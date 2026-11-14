/**
 * The audit store: the SQL of data-model §5.4 (as rewritten 2026-11-13, ADR-0007 amendment 10; D-ARCH-085/087),
 * executed on the business transaction it is handed (REQ-AUDIT-004; TASK-025).
 *
 * The store is typed on a STRUCTURAL port of the two tagged-template raw methods of `TenantDb` (D-ARCH-103 (5),
 * ADR-0003 amendment 2026-11-13): it constructs no client, imports neither Prisma nor `pg`, and so can only join the
 * transaction the caller passes in (PR2-SEC-05, PR11-SEC-05 item 2, D-ARCH-074). A second pool would run without the
 * tenant context and commit audit rows outside the business transaction. The writer API takes a TenantDb or a job
 * context, never a raw migrator connection: the migrator has no privilege on any audit table (D-ARCH-075).
 *
 * Statement sequence per entry (the vault statements only when the entry carries personal values):
 *   1.  one multi-row vault `INSERT … SELECT FROM unnest(…) ON CONFLICT DO NOTHING`             {@link insertVaultRows}
 *   1b. one token lookup as a SEPARATE statement (new snapshot: sees a concurrent winner's row)  {@link insertVaultRows}
 *   2.  head-row lock + head read + database clock in ONE statement, under the audit lock_timeout {@link lockHead}
 *   2b. only when (2) found no head (first entry of a stream): create it, then repeat (2)
 *   3.  the entry hash, in process (no statement)
 *   4.  ONE statement appends the entry and advances the head; expectAffected(1)                {@link appendEntry}
 *   5.  COMMIT, by the caller's transaction.
 * From lock grant to COMMIT inclusive that is two round trips (4 and 5); nothing else runs under the lock and no
 * other lock is taken after it (deadlock freedom: the audit append is the last database work of the transaction).
 * TASK-030 owns the proof of that budget (statement-sequence test, held-row timing, 50 parallel writers, the token
 * plan against a 100 k-row vault).
 *
 * SQL rules (data-model §5.4 (a)-(f), §8.3): built-ins are `pg_catalog.`-qualified except multi-argument `unnest` and
 * `extract(… FROM …)` (keyword syntax); no `RETURNING` on the append; arrays and bytea travel as typed parameters
 * (`$n::uuid[]`; bytea arrays as hex `text[]` decoded in SQL, D-TASK025-12), never as `Prisma.join` / `Prisma.sql`
 * fragments, which `TenantDb` refuses; the zero hash is `decode(repeat('00', 32), 'hex')`, never a text expression (42804, D-ARCH-087).
 */
import type { PiiClassification } from '../actions.js';
import { type AuditRowDraft, type ChainPosition, computeEntryHash, formatMicros, nextOccurredAt } from '../entry-hash.js';
import { AuditWriteError } from '../errors.js';

/**
 * The two raw methods of the business transaction's `TenantDb` (tagged templates only; every value is bound) and its
 * rollback-only latch. A `TenantDb<AppTransactionClient>` satisfies it structurally. A function taking this port runs
 * inside the transaction, so it is a T-83 root (PR42-SEC-07): no external I/O or sleeps in it.
 */
export interface AuditSqlPort {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
  /**
   * Marks the enclosing transaction rollback-only (PR42-SEC-02): the transaction owner refuses to commit it even when
   * the callback returns normally (`withTenantTx` rethrows the first marked failure, so Prisma rolls back). The
   * writer calls it on every failure before throwing.
   */
  markRollbackOnly(failure: Error): void;
}

export interface AppendOptions {
  /** `DB_AUDIT_LOCK_TIMEOUT_MS`: the head-row lock wait bound (default 250 ms, below `DB_TX_LOCK_TIMEOUT_MS`). */
  readonly lockTimeoutMs: number;
  /** `created_by` / `updated_by` of the head row: the acting user, or the SYSTEM / ANONYMOUS actor. */
  readonly actorStamp: string;
}

/** What the append allocated under the lock. */
export interface AppendedEntry {
  readonly id: string;
  readonly streamId: string;
  readonly streamSeq: number;
  /** `YYYY-MM-DDTHH:MM:SS.ffffffZ` (database clock, UTC). */
  readonly occurredAt: string;
  /** Lower-case hex. */
  readonly prevHash: string;
  /** Lower-case hex. */
  readonly entryHash: string;
}

/** One encrypted vault row, as the tokeniser (TASK-028) prepares it. */
export interface VaultRow {
  /** UUIDv7 proposed for a new row; an existing row for the same subject/entity/field/value keeps its token. */
  readonly token: string;
  readonly subjectId: string;
  readonly classification: PiiClassification;
  readonly entityName: string;
  readonly field: string;
  /** HMAC-SHA256 of the value under the vault HMAC key: 32 bytes. */
  readonly valueHmac: Uint8Array;
  readonly valueHmacKeyId: string;
  /** AES-256-GCM `nonce ‖ ct ‖ tag`. */
  readonly ciphertext: Uint8Array;
  readonly ciphertextKeyId: string;
}

export interface AuditStore {
  /** Statements 2-4: allocates the chain position under the head-row lock and appends the entry. */
  append(db: AuditSqlPort, row: AuditRowDraft, options: AppendOptions): Promise<AppendedEntry>;
  /** Statements 1 and 1b: writes a batch of vault rows and returns the token of each, in input order. */
  insertVaultRows(db: AuditSqlPort, rows: readonly VaultRow[], actorStamp: string): Promise<string[]>;
}

/** Computes `entry_hash` from the row, its position and the predecessor's hash (data-model §5.4 step 3). */
export type EntryHasher = (row: AuditRowDraft, position: ChainPosition, prevHashHex: string) => string;

export interface PrismaAuditStoreOptions {
  /** Defaults to {@link computeEntryHash}; TASK-030 owns the chain module. */
  readonly hash?: EntryHasher;
}

interface HeadRow {
  readonly entry_count: string;
  readonly head_hash: string;
  readonly head_us: string | null;
  readonly now_us: string;
}

/** Statement 2: lock + head + clock in one round trip; the audit lock_timeout is set by the MATERIALIZED CTE. */
const lockHead = (db: AuditSqlPort, streamId: string, lockTimeoutMs: string): PromiseLike<HeadRow[]> =>
  db.$queryRaw<HeadRow[]>`WITH lt AS MATERIALIZED (SELECT pg_catalog.set_config('lock_timeout', ${lockTimeoutMs}, true) AS lock_timeout)
SELECT h.entry_count::text AS entry_count, pg_catalog.encode(h.head_hash, 'hex') AS head_hash,
       ((extract(epoch FROM h.head_occurred_at) * 1000000)::bigint)::text AS head_us,
       ((extract(epoch FROM pg_catalog.clock_timestamp()) * 1000000)::bigint)::text AS now_us
  FROM public.audit_stream_heads h CROSS JOIN lt
 WHERE h.stream_id = ${streamId}::uuid
   FOR UPDATE OF h`;

/** Statement 2b: the head of a new stream (zero hash in bytea form, D-ARCH-087). */
const createHead = (db: AuditSqlPort, streamId: string, actor: string): PromiseLike<number> =>
  db.$executeRaw`INSERT INTO public.audit_stream_heads (id, stream_id, entry_count, head_hash, last_verified_seq, last_verified_hash,
       created_at, updated_at, created_by, updated_by, version)
VALUES (pg_catalog.uuidv7(), ${streamId}::uuid, 0, pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'), 0,
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'), pg_catalog.now(), pg_catalog.now(), ${actor}::uuid, ${actor}::uuid, 1)
ON CONFLICT (stream_id) DO NOTHING`;

const jsonOrNull = (value: unknown): string | null => (value === null ? null : JSON.stringify(value));

/** Statement 4: append the entry and advance the head in one statement (no RETURNING). */
function appendEntry(db: AuditSqlPort, row: AuditRowDraft, seq: number, occurredAt: string, prev: string, hash: string, actor: string) {
  return db.$executeRaw`WITH appended AS (
  INSERT INTO public.audit_entries (id, occurred_at, stream_id, stream_seq, org_id, target_org_id, on_behalf_of_org_id,
         actor_type, user_id, api_key_id, job_name, actor_roles, session_id, ip_token, ip_hash, ip_hash_key_id, ip_coarse,
         user_agent_token, ua_parsed, source_app, correlation_id, action, entity_name, entity_id, outcome, reason_token,
         reauth_proof_id, signature_meaning, http_method, route, old_value, new_value, details, pii_token_count, hash_version,
         prev_hash, entry_hash)
  VALUES (${row.id}::uuid, ${occurredAt}::timestamptz, ${row.streamId}::uuid, ${seq}::bigint, ${row.orgId}::uuid,
          ${row.targetOrgId}::uuid, ${row.onBehalfOfOrgId}::uuid, ${row.actorType}, ${row.userId}::uuid, ${row.apiKeyId}::uuid,
          ${row.jobName}, ${[...row.actorRoles]}::text[], ${row.sessionId}::uuid, ${row.ipToken}::uuid,
          pg_catalog.decode(${row.ipHash}, 'hex'), ${row.ipHashKeyId}, ${row.ipCoarse}::inet, ${row.userAgentToken}::uuid,
          ${row.uaParsed}, ${row.sourceApp}, ${row.correlationId}, ${row.action}, ${row.entityName}, ${row.entityId}, ${row.outcome},
          ${row.reasonToken}::uuid, ${row.reauthProofId}::uuid, ${row.signatureMeaning}, ${row.httpMethod}, ${row.route},
          ${jsonOrNull(row.oldValue)}::jsonb, ${jsonOrNull(row.newValue)}::jsonb, ${jsonOrNull(row.details)}::jsonb,
          ${row.piiTokenCount}::integer, ${row.hashVersion}::smallint, pg_catalog.decode(${prev}, 'hex'),
          pg_catalog.decode(${hash}, 'hex')))
UPDATE public.audit_stream_heads
   SET entry_count = ${seq}::bigint, head_entry_id = ${row.id}::uuid, head_occurred_at = ${occurredAt}::timestamptz,
       head_hash = pg_catalog.decode(${hash}, 'hex'), updated_at = pg_catalog.now(), updated_by = ${actor}::uuid,
       version = version + 1
 WHERE stream_id = ${row.streamId}::uuid AND entry_count = ${seq - 1}::bigint`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGITS = /^\d{1,18}$/;
const MICROS = /^-?\d{1,20}$/;
const HASH_HEX = /^[0-9a-f]{64}$/;

/** Parses the head row; a shape the statement cannot produce is an integrity failure. */
function parseHead(head: HeadRow): {
  readonly entryCount: number;
  readonly headHash: string;
  readonly headMicros: bigint | null;
  readonly nowMicros: bigint;
} {
  if (!DIGITS.test(head.entry_count) || !HASH_HEX.test(head.head_hash) || !MICROS.test(head.now_us)) {
    throw new AuditWriteError('DATABASE_ERROR');
  }
  if (head.head_us !== null && !MICROS.test(head.head_us)) throw new AuditWriteError('DATABASE_ERROR');
  return {
    entryCount: Number(head.entry_count),
    headHash: head.head_hash,
    headMicros: head.head_us === null ? null : BigInt(head.head_us),
    nowMicros: BigInt(head.now_us),
  };
}

function lockTimeoutText(ms: number): string {
  if (!Number.isInteger(ms) || ms < 1 || ms > 60_000) throw new RangeError('lockTimeoutMs must be an integer in 1..60000');
  return String(ms);
}

function vaultBatch(rows: readonly VaultRow[]) {
  const [first] = rows;
  if (first === undefined) return undefined;
  const sameKeys = rows.every((row) => row.valueHmacKeyId === first.valueHmacKeyId && row.ciphertextKeyId === first.ciphertextKeyId);
  if (!sameKeys || rows.some((row) => row.valueHmac.length !== 32)) throw new AuditWriteError('TOKENISER_FAILED');
  return {
    tokens: rows.map((row) => row.token),
    subjects: rows.map((row) => row.subjectId),
    classifications: rows.map((row) => row.classification),
    entities: rows.map((row) => row.entityName),
    fields: rows.map((row) => row.field),
    hmacs: rows.map((row) => Buffer.from(row.valueHmac).toString('hex')),
    ciphertexts: rows.map((row) => Buffer.from(row.ciphertext).toString('hex')),
    hmacKeyId: first.valueHmacKeyId,
    ciphertextKeyId: first.ciphertextKeyId,
  };
}

export function createPrismaAuditStore(options: PrismaAuditStoreOptions = {}): AuditStore {
  const hash = options.hash ?? computeEntryHash;

  /**
   * Statement 2, and 2b + 2 for the first entry of a stream. R1-n1: when statement 2 returns no row, whether its CTE
   * (the audit `lock_timeout`) ran depends on the plan, so 2b, which can wait on a concurrent first inserter of the
   * same head, runs under the transaction's `DB_TX_LOCK_TIMEOUT_MS` (2 s), not the audit 250 ms; once per stream.
   * TASK-030 E2 covers 2b.
   */
  async function lockedHead(db: AuditSqlPort, row: AuditRowDraft, timeout: string, actor: string): Promise<HeadRow> {
    const [head] = await lockHead(db, row.streamId, timeout);
    if (head !== undefined) return head;
    await createHead(db, row.streamId, actor);
    const [created] = await lockHead(db, row.streamId, timeout);
    if (created === undefined) throw new AuditWriteError('HEAD_MISSING');
    return created;
  }

  async function append(db: AuditSqlPort, row: AuditRowDraft, appendOptions: AppendOptions): Promise<AppendedEntry> {
    const timeout = lockTimeoutText(appendOptions.lockTimeoutMs);
    const head = parseHead(await lockedHead(db, row, timeout, appendOptions.actorStamp));
    const position: ChainPosition = {
      streamSeq: head.entryCount + 1,
      occurredAtMicros: nextOccurredAt(head.nowMicros, head.headMicros),
    };
    const occurredAt = formatMicros(position.occurredAtMicros);
    const entryHash = hash(row, position, head.headHash);
    const affected = await appendEntry(db, row, position.streamSeq, occurredAt, head.headHash, entryHash, appendOptions.actorStamp);
    if (affected !== 1) throw new AuditWriteError('HEAD_MOVED');
    return { id: row.id, streamId: row.streamId, streamSeq: position.streamSeq, occurredAt, prevHash: head.headHash, entryHash };
  }

  async function insertVaultRows(db: AuditSqlPort, rows: readonly VaultRow[], actorStamp: string): Promise<string[]> {
    const batch = vaultBatch(rows);
    if (batch === undefined) return [];
    await db.$executeRaw`INSERT INTO public.audit_pii_vault (token, subject_id, classification, entity_name, field, value_hmac,
       value_hmac_key_id, ciphertext, ciphertext_key_id, created_at, updated_at, created_by, updated_by, version)
SELECT t.token, t.subject_id, t.classification, t.entity_name, t.field, pg_catalog.decode(t.value_hmac, 'hex'), ${batch.hmacKeyId},
       pg_catalog.decode(t.ciphertext, 'hex'), ${batch.ciphertextKeyId}, pg_catalog.now(), pg_catalog.now(), ${actorStamp}::uuid,
       ${actorStamp}::uuid, 1
  FROM unnest(${batch.tokens}::uuid[], ${batch.subjects}::uuid[], ${batch.classifications}::text[], ${batch.entities}::text[],
              ${batch.fields}::text[], ${batch.hmacs}::text[], ${batch.ciphertexts}::text[])
       AS t(token, subject_id, classification, entity_name, field, value_hmac, ciphertext)
ON CONFLICT (subject_id, entity_name, field, value_hmac) DO NOTHING`;
    const found = await db.$queryRaw<Array<{ ord: number; token: string }>>`SELECT k.ord::integer AS ord, v.token::text AS token
  FROM unnest(${batch.subjects}::uuid[], ${batch.entities}::text[], ${batch.fields}::text[], ${batch.hmacs}::text[]) WITH ORDINALITY
       AS k(subject_id, entity_name, field, value_hmac, ord)
  CROSS JOIN LATERAL (SELECT p.token FROM public.audit_pii_vault p
                       WHERE p.subject_id = k.subject_id AND p.entity_name = k.entity_name AND p.field = k.field
                         AND p.value_hmac = pg_catalog.decode(k.value_hmac, 'hex')
                       LIMIT 1) v`;
    const tokens = new Array<string | undefined>(rows.length).fill(undefined);
    for (const { ord, token } of found) {
      const index = Number(ord) - 1;
      if (Number.isInteger(index) && index >= 0 && index < rows.length && UUID.test(token)) tokens[index] = token;
    }
    if (tokens.some((token) => token === undefined)) throw new AuditWriteError('TOKENISER_FAILED');
    return tokens as string[];
  }

  return { append, insertVaultRows };
}
