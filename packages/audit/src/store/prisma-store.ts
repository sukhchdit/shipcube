/**
 * The audit store: the SQL of data-model §5.4 (as rewritten 2026-11-13, ADR-0007 amendment 10; D-ARCH-085/087, amended
 * 2026-11-14 by ADR-0007 amendment 11 item 3 / D-ARCH-122), executed on the business transaction it is handed
 * (REQ-AUDIT-004; TASK-025, TASK-029).
 *
 * The store is typed on a STRUCTURAL port of the two tagged-template raw methods of `TenantDb` (D-ARCH-103 (5),
 * ADR-0003 amendment 2026-11-13): it constructs no client, imports neither Prisma nor `pg`, and so can only join the
 * transaction the caller passes in (PR2-SEC-05, PR11-SEC-05 item 2, D-ARCH-074). A second pool would run without the
 * tenant context and commit audit rows outside the business transaction. The writer API takes a TenantDb or a job
 * context, never a raw migrator connection: the migrator has no privilege on any audit table (D-ARCH-075).
 *
 * Statement sequence of ONE flush (D-ARCH-122: every entry the transaction recorded; the vault statements only when an
 * entry carries personal values):
 *   1.  one multi-row vault `INSERT … SELECT FROM unnest(…) ON CONFLICT DO NOTHING`, for ALL entries  {@link insertVaultRows}
 *   1b. one token lookup as a SEPARATE statement (new snapshot: sees a concurrent winner's row)       {@link insertVaultRows}
 *   2.  per stream, in ascending `stream_id` order: head-row lock + head read + database clock in ONE statement, under
 *       the audit lock_timeout; every head lock before the first append                               {@link appendBatch}
 *   2b. only when (2) found no head (first entry of a stream): create it, then repeat (2)
 *   3.  the entry hashes, chained in process per stream (no statement)
 *   4.  per stream, ONE statement appends that stream's N entries (consecutive `stream_seq`) and advances its head by N;
 *       expectAffected(1)                                                                              {@link appendStream}
 *   5.  COMMIT, by the caller's transaction.
 * For one stream (every M0/M1 flow: a tenant transaction writes its organisation's stream, an organisation-less one a
 * SYSTEM shard) that is two round trips from lock grant to COMMIT inclusive (4 and 5), whatever N is; for k streams it
 * is k lock round trips + k appends + COMMIT. The only locks taken after the first head lock are further head locks in
 * ascending order (deadlock freedom: every writer locks in the same order, and the audit flush is the last database
 * work of the transaction). TASK-030 moves these statements into `chain/**` and owns the proof of the budget
 * (statement-sequence test, held-row timing, 50 parallel writers, the token plan against a 100 k-row vault).
 *
 * SQL rules (data-model §5.4 (a)-(f), §8.3): built-ins are `pg_catalog.`-qualified except multi-argument `unnest` and
 * `extract(… FROM …)` (keyword syntax); no `RETURNING` on the append; arrays and bytea travel as typed parameters
 * (`$n::uuid[]`; bytea as hex `text` decoded in SQL, D-TASK025-12; jsonb values as their JSON text), never as
 * `Prisma.join` / `Prisma.sql` fragments, which `TenantDb` refuses; the zero hash is `decode(repeat('00', 32), 'hex')`,
 * never a text expression (42804, D-ARCH-087).
 */
import type { PiiClassification } from '../actions.js';
import { type AuditRowDraft, type ChainPosition, computeEntryHash, formatMicros, nextOccurredAt } from '../entry-hash.js';
import { AuditWriteError } from '../errors.js';

/**
 * The two raw methods of the business transaction's `TenantDb` (tagged templates only; every value is bound) and its
 * latch members. A `TenantDb<AppTransactionClient>` satisfies it structurally. A function taking this port runs inside
 * the transaction, so it is a T-83 root (PR42-SEC-07): no external I/O or sleeps in it.
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
  /**
   * Starts `work` and registers it as in flight on the enclosing transaction (PR42-SEC-13): the transaction owner
   * awaits every tracked work before it reads the latch and commits, so a write the callback did not await still
   * completes, or marks the transaction rollback-only, before COMMIT. Refused (it throws) once the transaction settled;
   * `work` is then never started. The writer runs every `write()` and `flush()` through it.
   */
  track<T>(work: () => Promise<T>): Promise<T>;
  /**
   * Registers a check the transaction owner runs after settling and before it reads the latch and commits
   * (D-ARCH-122 I3): an `Error` returned by any check fails the transaction. The writer registers "recorded entries
   * were flushed" on the first `record` of a transaction. Refused once the transaction settled.
   */
  beforeCommit(check: () => Error | undefined): void;
  /**
   * The validated organisation of the transaction (its tenant context): a lower-case UUID, or `''` for an
   * organisation-less transaction (D-ARCH-122 stream check: `audit_entries` has no RLS, so this is the guard against
   * a capture bug writing the stream of organisation B from a transaction of organisation A).
   */
  contextOrgId(): string;
}

export interface AppendOptions {
  /** `DB_AUDIT_LOCK_TIMEOUT_MS`: the head-row lock wait bound (default 250 ms, below `DB_TX_LOCK_TIMEOUT_MS`). */
  readonly lockTimeoutMs: number;
  /** `created_by` / `updated_by` of the head rows: the acting user, or the SYSTEM / ANONYMOUS actor. */
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
  /**
   * Statements 2-4 for every row of one flush: locks the heads of all streams in ascending `stream_id` order, then
   * appends each stream's rows with ONE statement. Returns the chain position of every row, in input order.
   */
  appendBatch(db: AuditSqlPort, rows: readonly AuditRowDraft[], options: AppendOptions): Promise<AppendedEntry[]>;
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

/** One row of a stream batch with the chain position and hashes computed in process (step 3). */
interface ChainedRow {
  readonly row: AuditRowDraft;
  readonly seq: number;
  readonly occurredAt: string;
  readonly prevHash: string;
  readonly entryHash: string;
}

/** The bind arrays of one stream batch, one element per row, in `stream_seq` order. */
function columns(batch: readonly ChainedRow[]) {
  const of = <T>(pick: (row: AuditRowDraft) => T): T[] => batch.map(({ row }) => pick(row));
  return {
    ids: of((row) => row.id),
    occurred: batch.map((entry) => entry.occurredAt),
    seqs: batch.map((entry) => String(entry.seq)),
    orgIds: of((row) => row.orgId),
    targetOrgIds: of((row) => row.targetOrgId),
    onBehalfOfOrgIds: of((row) => row.onBehalfOfOrgId),
    actorTypes: of((row) => row.actorType),
    userIds: of((row) => row.userId),
    apiKeyIds: of((row) => row.apiKeyId),
    jobNames: of((row) => row.jobName),
    roles: of((row) => JSON.stringify([...row.actorRoles])),
    sessionIds: of((row) => row.sessionId),
    ipTokens: of((row) => row.ipToken),
    ipHashes: of((row) => row.ipHash),
    ipHashKeyIds: of((row) => row.ipHashKeyId),
    ipCoarse: of((row) => row.ipCoarse),
    userAgentTokens: of((row) => row.userAgentToken),
    uaParsed: of((row) => row.uaParsed),
    sourceApps: of((row) => row.sourceApp),
    correlationIds: of((row) => row.correlationId),
    actions: of((row) => row.action),
    entityNames: of((row) => row.entityName),
    entityIds: of((row) => row.entityId),
    outcomes: of((row) => row.outcome),
    reasonTokens: of((row) => row.reasonToken),
    reauthProofIds: of((row) => row.reauthProofId),
    signatureMeanings: of((row) => row.signatureMeaning),
    httpMethods: of((row) => row.httpMethod),
    routes: of((row) => row.route),
    oldValues: of((row) => jsonOrNull(row.oldValue)),
    newValues: of((row) => jsonOrNull(row.newValue)),
    details: of((row) => jsonOrNull(row.details)),
    piiTokenCounts: of((row) => String(row.piiTokenCount)),
    hashVersions: of((row) => String(row.hashVersion)),
    prevHashes: batch.map((entry) => entry.prevHash),
    entryHashes: batch.map((entry) => entry.entryHash),
  };
}

/**
 * Statement 4: append one stream's entries and advance its head by N in one statement (no RETURNING). The head moves
 * only from the count it had under the lock (`entry_count = first_seq - 1`), so a tampered head fails expectAffected(1).
 * `actor_roles` travels as one JSON array text per row and is rebuilt in order (a `text[]` per row cannot be unnested).
 */
function appendStream(db: AuditSqlPort, streamId: string, batch: readonly ChainedRow[], actor: string): PromiseLike<number> {
  const c = columns(batch);
  const first = batch[0] as ChainedRow;
  const last = batch[batch.length - 1] as ChainedRow;
  return db.$executeRaw`WITH appended AS (
  INSERT INTO public.audit_entries (id, occurred_at, stream_id, stream_seq, org_id, target_org_id, on_behalf_of_org_id,
         actor_type, user_id, api_key_id, job_name, actor_roles, session_id, ip_token, ip_hash, ip_hash_key_id, ip_coarse,
         user_agent_token, ua_parsed, source_app, correlation_id, action, entity_name, entity_id, outcome, reason_token,
         reauth_proof_id, signature_meaning, http_method, route, old_value, new_value, details, pii_token_count, hash_version,
         prev_hash, entry_hash)
  SELECT e.id, e.occurred_at, ${streamId}::uuid, e.stream_seq, e.org_id, e.target_org_id, e.on_behalf_of_org_id, e.actor_type,
         e.user_id, e.api_key_id, e.job_name,
         ARRAY(SELECT r.role FROM pg_catalog.jsonb_array_elements_text(e.actor_roles) WITH ORDINALITY AS r(role, n) ORDER BY r.n),
         e.session_id, e.ip_token, pg_catalog.decode(e.ip_hash, 'hex'), e.ip_hash_key_id, e.ip_coarse, e.user_agent_token,
         e.ua_parsed, e.source_app, e.correlation_id, e.action, e.entity_name, e.entity_id, e.outcome, e.reason_token,
         e.reauth_proof_id, e.signature_meaning, e.http_method, e.route, e.old_value, e.new_value, e.details, e.pii_token_count,
         e.hash_version, pg_catalog.decode(e.prev_hash, 'hex'), pg_catalog.decode(e.entry_hash, 'hex')
    FROM unnest(${c.ids}::uuid[], ${c.occurred}::timestamptz[], ${c.seqs}::bigint[], ${c.orgIds}::uuid[], ${c.targetOrgIds}::uuid[],
                ${c.onBehalfOfOrgIds}::uuid[], ${c.actorTypes}::text[], ${c.userIds}::uuid[], ${c.apiKeyIds}::uuid[],
                ${c.jobNames}::text[], ${c.roles}::jsonb[], ${c.sessionIds}::uuid[], ${c.ipTokens}::uuid[], ${c.ipHashes}::text[],
                ${c.ipHashKeyIds}::text[], ${c.ipCoarse}::inet[], ${c.userAgentTokens}::uuid[], ${c.uaParsed}::text[],
                ${c.sourceApps}::text[], ${c.correlationIds}::text[], ${c.actions}::text[], ${c.entityNames}::text[],
                ${c.entityIds}::text[], ${c.outcomes}::text[], ${c.reasonTokens}::uuid[], ${c.reauthProofIds}::uuid[],
                ${c.signatureMeanings}::text[], ${c.httpMethods}::text[], ${c.routes}::text[], ${c.oldValues}::jsonb[],
                ${c.newValues}::jsonb[], ${c.details}::jsonb[], ${c.piiTokenCounts}::integer[], ${c.hashVersions}::smallint[],
                ${c.prevHashes}::text[], ${c.entryHashes}::text[])
         AS e(id, occurred_at, stream_seq, org_id, target_org_id, on_behalf_of_org_id, actor_type, user_id, api_key_id, job_name,
              actor_roles, session_id, ip_token, ip_hash, ip_hash_key_id, ip_coarse, user_agent_token, ua_parsed, source_app,
              correlation_id, action, entity_name, entity_id, outcome, reason_token, reauth_proof_id, signature_meaning,
              http_method, route, old_value, new_value, details, pii_token_count, hash_version, prev_hash, entry_hash))
UPDATE public.audit_stream_heads
   SET entry_count = ${String(last.seq)}::bigint, head_entry_id = ${last.row.id}::uuid,
       head_occurred_at = ${last.occurredAt}::timestamptz, head_hash = pg_catalog.decode(${last.entryHash}, 'hex'),
       updated_at = pg_catalog.now(), updated_by = ${actor}::uuid, version = version + 1
 WHERE stream_id = ${streamId}::uuid AND entry_count = ${String(first.seq - 1)}::bigint`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGITS = /^\d{1,18}$/;
const MICROS = /^-?\d{1,20}$/;
const HASH_HEX = /^[0-9a-f]{64}$/;

interface ParsedHead {
  readonly entryCount: number;
  readonly headHash: string;
  readonly headMicros: bigint | null;
  readonly nowMicros: bigint;
}

/** Parses the head row; a shape the statement cannot produce is an integrity failure. */
function parseHead(head: HeadRow): ParsedHead {
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

/** The rows of a flush grouped by stream (input order kept inside a stream), streams in ascending `stream_id` order. */
function streamsOf(rows: readonly AuditRowDraft[]): Array<readonly [string, AuditRowDraft[]]> {
  const streams = new Map<string, AuditRowDraft[]>();
  for (const row of rows) {
    const batch = streams.get(row.streamId);
    if (batch === undefined) streams.set(row.streamId, [row]);
    else batch.push(row);
  }
  // Lower-case canonical UUID text sorts like its bytes (hex digits and hyphens at fixed positions; D-ARCH-122 (b)).
  return [...streams].sort(([a], [b]) => (a < b ? -1 : 1));
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
  async function lockedHead(db: AuditSqlPort, streamId: string, timeout: string, actor: string): Promise<HeadRow> {
    const [head] = await lockHead(db, streamId, timeout);
    if (head !== undefined) return head;
    await createHead(db, streamId, actor);
    const [created] = await lockHead(db, streamId, timeout);
    if (created === undefined) throw new AuditWriteError('HEAD_MISSING');
    return created;
  }

  /** Step 3: positions and hashes of one stream's rows, chained in memory from the locked head. */
  function chain(rows: readonly AuditRowDraft[], head: ParsedHead): ChainedRow[] {
    let prevHash = head.headHash;
    let prevMicros = head.headMicros;
    return rows.map((row, index) => {
      const position: ChainPosition = {
        streamSeq: head.entryCount + 1 + index,
        occurredAtMicros: nextOccurredAt(head.nowMicros, prevMicros),
      };
      const entryHash = hash(row, position, prevHash);
      const chained = { row, seq: position.streamSeq, occurredAt: formatMicros(position.occurredAtMicros), prevHash, entryHash };
      prevHash = entryHash;
      prevMicros = position.occurredAtMicros;
      return chained;
    });
  }

  async function appendBatch(db: AuditSqlPort, rows: readonly AuditRowDraft[], appendOptions: AppendOptions): Promise<AppendedEntry[]> {
    const timeout = lockTimeoutText(appendOptions.lockTimeoutMs);
    const streams = streamsOf(rows);
    // Every head lock, in ascending stream order, before the first append (D-ARCH-122 (b)): sequential on purpose.
    const heads: ParsedHead[] = [];
    for (const [streamId] of streams) heads.push(parseHead(await lockedHead(db, streamId, timeout, appendOptions.actorStamp)));
    const appended = new Map<AuditRowDraft, AppendedEntry>();
    for (const [index, [streamId, batch]] of streams.entries()) {
      const chained = chain(batch, heads[index] as ParsedHead);
      if ((await appendStream(db, streamId, chained, appendOptions.actorStamp)) !== 1) throw new AuditWriteError('HEAD_MOVED');
      for (const { row, seq, occurredAt, prevHash, entryHash } of chained) {
        appended.set(row, { id: row.id, streamId, streamSeq: seq, occurredAt, prevHash, entryHash });
      }
    }
    return rows.map((row) => appended.get(row) as AppendedEntry);
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

  return { appendBatch, insertVaultRows };
}
