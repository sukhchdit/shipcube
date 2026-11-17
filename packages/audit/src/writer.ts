/**
 * The audit writer (REQ-AUDIT-002/003/004/010/011, ADR-0007 §Capture, amendment 10 and amendment 11 item 3; data-model
 * §5.4; US-087, US-088; TASK-025, TASK-029 / D-ARCH-122).
 *
 * The writer runs INSIDE the transaction it is handed, as the last database work before COMMIT. ONE FLUSH PER
 * TRANSACTION (D-ARCH-122):
 *  - `record(db, entry)` validates the COMPLETE entry (personal values marked) and buffers it for `db`'s transaction;
 *    nothing is sent. Several entries per transaction are design: the capture middleware and the state machine record
 *    in the same business transaction, `x-audit.additional[]` declares a second entry, one `SESSION_REVOKED` per session.
 *  - `flush(db)` runs once, by the owner of the transaction end (the tx slot's audit hook, D-ARCH-106; the worker's job
 *    step wrapper): every personal value of every recorded entry is tokenised in ONE batch before any lock (one vault
 *    INSERT and one lookup, D-ARCH-085), then the store locks the stream heads in ascending order and appends each
 *    stream's entries with one statement, so the lock budget of ADR-0007 am. 10 holds whatever the number of entries.
 *  - `write(db, entry)` = `record` + `flush`, for a transaction whose only audit work is one entry (I4): a FAILED
 *    outcome (409/422/5xx after authorisation) and a VIEW / DOWNLOAD entry are written by the caller in a SEPARATE
 *    short transaction after the business one rolled back or the result set was fixed (REQ-AUDIT-010, REQ-AUDIT-005).
 * Invariants: I1 one flush per transaction; I2 a `record` after the flush, or a second flush, fails the transaction
 * (500 AUDIT_WRITE_FAILED, kind WRITE_AFTER_FLUSH); I3 a recorded entry still unflushed when the callback returns fails
 * the transaction (kind UNFLUSHED_ENTRIES, through {@link AuditSqlPort.beforeCommit}); STREAM: a tenant entry whose
 * organisation is not the transaction's (`app.org_id`, {@link AuditSqlPort.contextOrgId}) is refused at `record`
 * (kind STREAM_MISMATCH): `audit_entries` has no RLS, so this is the only guard against writing another tenant's stream.
 * One writer instance per process (the composition root's): the buffer belongs to the instance, so a second instance
 * recording into the same transaction would need a flush of its own (I1).
 *
 * Failures are `AuditWriteError`: 503 AUDIT_LOCK_TIMEOUT (retryable, `Retry-After: 1`) for SQLSTATE 55P03, 500
 * AUDIT_WRITE_FAILED for everything else. Every failure marks the transaction rollback-only through
 * {@link AuditSqlPort.markRollbackOnly} before it is thrown (PR42-SEC-02), so a caller that catches and swallows it
 * still cannot commit the business change without its entry. `flush` and `write` run through
 * {@link AuditSqlPort.track} (PR42-SEC-13), so one the callback started but did not await is awaited by the transaction
 * owner before COMMIT. Their returned promises are already marked handled (PR42-SEC-19, code review R3-m1): an awaiting
 * caller still receives the rejection, but a caller that drops the promise does not raise an unhandled rejection
 * (which the API answers with a process exit). Always await them; a deliberately detached write must at least
 * `.catch(log)` it, never `void` it, and must START inside the callback: a write whose start is deferred to a timer
 * runs after COMMIT and is refused (`TENANT_TX_CLOSED`), which `withTenantTx` cannot see (PR42-SEC-17 residual; the
 * TASK-033 audit-completeness suite is the backstop).
 */
import { randomInt } from 'node:crypto';

import { ANONYMOUS_ACTOR_ID, uuidv7 } from '@platform/shared';

import { type AuditEntryInput, type IpIndex, type PiiValue, type PreparedEntry, prepareEntry } from './entry.js';
import { AuditWriteError, isAuditWriteError, toAuditWriteError } from './errors.js';
import type { AppendedEntry, AuditSqlPort, AuditStore } from './store/prisma-store.js';

/**
 * Turns personal values into vault tokens, in order, in ONE batch per flush (TASK-028 implements it with
 * `AuditStore.insertVaultRows`: subject resolution, HMAC and AES-256-GCM).
 */
export interface PiiTokeniser {
  tokenise(db: AuditSqlPort, values: readonly PiiValue[]): Promise<readonly string[]>;
}

export interface AuditWriterOptions {
  readonly store: AuditStore;
  /** `DB_AUDIT_LOCK_TIMEOUT_MS` (default 250 ms, validated below `DB_TX_LOCK_TIMEOUT_MS` by the config). */
  readonly lockTimeoutMs: number;
  /** Required as soon as an entry carries a personal value: without it such an entry fails closed. */
  readonly tokeniser?: PiiTokeniser;
  /** `ip_hash` index; without it `ip_hash` stays NULL (the IP is still tokenised and coarsened). */
  readonly ipIndex?: IpIndex;
  /** Entry id factory (UUIDv7); injectable for tests. */
  readonly newId?: () => string;
  /**
   * SYSTEM shard 0..15 for entries without an organisation (ADR-0007 am. 1). Defaults to a server-side random draw,
   * never a client value, so a crafted correlation id cannot pile anonymous writers onto one shard (SEC-TC-57;
   * TASK-030 owns the shard-key proof).
   */
  readonly systemShard?: () => number;
}

export interface AuditWriter {
  /**
   * Validates one complete entry and buffers it for `db`'s transaction (D-ARCH-122). Synchronous; nothing is sent. On a
   * refusal (invalid entry, STREAM_MISMATCH, WRITE_AFTER_FLUSH) the transaction is marked rollback-only and the
   * `AuditWriteError` is thrown.
   */
  record(db: AuditSqlPort, entry: AuditEntryInput): void;
  /**
   * The one flush of `db`'s transaction: appends every recorded entry; returns their chain positions in record order
   * (empty when nothing was recorded). A second flush fails (WRITE_AFTER_FLUSH). The returned promise is handled.
   */
  flush(db: AuditSqlPort): Promise<readonly AppendedEntry[]>;
  /** `record` + `flush` for a transaction whose only audit work is this entry (I4); returns its chain position. */
  write(db: AuditSqlPort, entry: AuditEntryInput): Promise<AppendedEntry>;
}

const SHARDS = 16;

/** The audit work of one transaction (I1-I3): the recorded entries and whether the flush ran. */
interface TransactionAudit {
  readonly entries: PreparedEntry[];
  flushed: boolean;
}

const ignore = (): void => undefined;

/**
 * PR42-SEC-19: starts `work` now (a synchronous throw becomes a rejection) and marks the promise handled; the
 * returned promise is the same object, so an awaiting caller still sees its rejection.
 */
function handled<T>(work: () => Promise<T>): Promise<T> {
  let promise: Promise<T>;
  try {
    promise = work();
  } catch (error) {
    promise = Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
  promise.catch(ignore);
  return promise;
}

export function createAuditWriter(options: AuditWriterOptions): AuditWriter {
  if (!Number.isInteger(options.lockTimeoutMs) || options.lockTimeoutMs < 1) {
    throw new RangeError('lockTimeoutMs must be a positive integer (DB_AUDIT_LOCK_TIMEOUT_MS)');
  }
  const newId = options.newId ?? uuidv7;
  const systemShard = options.systemShard ?? ((): number => randomInt(SHARDS));
  /** Per transaction, keyed by its handle (a `TenantDb` lives exactly as long as its transaction). */
  const transactions = new WeakMap<AuditSqlPort, TransactionAudit>();

  /** PR42-SEC-02: the latch is marked before the refusal leaves the writer. */
  function refuse(db: AuditSqlPort, error: unknown): never {
    const failure = toAuditWriteError(error);
    db.markRollbackOnly(failure);
    throw failure;
  }

  /** The audit work of `db`'s transaction; the first use registers the I3 check with the transaction owner. */
  function transactionOf(db: AuditSqlPort): TransactionAudit {
    const known = transactions.get(db);
    if (known !== undefined) return known;
    const created: TransactionAudit = { entries: [], flushed: false };
    db.beforeCommit(() => (created.flushed || created.entries.length === 0 ? undefined : new AuditWriteError('UNFLUSHED_ENTRIES')));
    transactions.set(db, created);
    return created;
  }

  function prepare(entry: AuditEntryInput): PreparedEntry {
    try {
      return prepareEntry(entry, {
        id: newId(),
        systemShard: systemShard(),
        ...(options.ipIndex === undefined ? {} : { ipIndex: options.ipIndex }),
      });
    } catch (error) {
      // A throwing accessor in the input or a failing IP index: still a refusal, never an unmapped error.
      throw isAuditWriteError(error) ? error : new AuditWriteError('INVALID_ENTRY', { cause: error });
    }
  }

  function record(db: AuditSqlPort, entry: AuditEntryInput): void {
    try {
      const audit = transactionOf(db);
      if (audit.flushed) throw new AuditWriteError('WRITE_AFTER_FLUSH');
      const prepared = prepare(entry);
      if (prepared.orgId !== null && prepared.orgId !== db.contextOrgId().toLowerCase()) throw new AuditWriteError('STREAM_MISMATCH');
      audit.entries.push(prepared);
    } catch (error) {
      refuse(db, error);
    }
  }

  async function tokenise(db: AuditSqlPort, values: readonly PiiValue[]): Promise<readonly string[]> {
    if (values.length === 0) return [];
    if (options.tokeniser === undefined) throw new AuditWriteError('TOKENISER_UNAVAILABLE');
    try {
      return await options.tokeniser.tokenise(db, values);
    } catch (error) {
      throw toAuditWriteError(error, 'TOKENISER_FAILED');
    }
  }

  async function flushTracked(db: AuditSqlPort): Promise<readonly AppendedEntry[]> {
    try {
      const audit = transactionOf(db);
      if (audit.flushed) throw new AuditWriteError('WRITE_AFTER_FLUSH');
      // Set before the first await: a concurrent second flush or a late record is refused (I1, I2).
      audit.flushed = true;
      const entries = [...audit.entries];
      if (entries.length === 0) return [];
      // ONE batch for every entry of the transaction, before any lock (D-ARCH-122 (a)); frozen like each entry's own list.
      const values = Object.freeze(entries.flatMap((prepared) => prepared.piiValues));
      const tokens = await tokenise(db, values);
      // Each entry takes its own slice, so a list of the wrong length is refused for the whole batch here.
      if (tokens.length !== values.length) throw new AuditWriteError('TOKENISER_FAILED');
      let cursor = 0;
      const rows = entries.map((prepared) => prepared.complete(tokens.slice(cursor, (cursor += prepared.piiValues.length))));
      const actorStamp = (entries[0] as PreparedEntry).userId ?? ANONYMOUS_ACTOR_ID;
      return await options.store.appendBatch(db, rows, { lockTimeoutMs: options.lockTimeoutMs, actorStamp });
    } catch (error) {
      // PR42-SEC-02: refusals raised before any SQL error (tokeniser, moved head) leave the transaction healthy, so the
      // latch, not the caller's rethrow, is what keeps the business change from committing alone.
      return refuse(db, error);
    }
  }

  const flush = (db: AuditSqlPort): Promise<readonly AppendedEntry[]> => handled(() => db.track(() => flushTracked(db)));

  const write = (db: AuditSqlPort, entry: AuditEntryInput): Promise<AppendedEntry> =>
    handled(() =>
      db.track(async () => {
        record(db, entry);
        const appended = await flushTracked(db);
        // `record` succeeded, so the flush appended at least this entry; it is the last one recorded.
        return appended[appended.length - 1] as AppendedEntry;
      }),
    );

  return { record, flush, write };
}
