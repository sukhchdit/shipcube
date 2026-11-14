/**
 * The audit writer (REQ-AUDIT-002/003/004/010/011, ADR-0007 §Capture and amendment 10; data-model §5.4; US-087,
 * US-088; TASK-025).
 *
 * `write(db, entry)` runs INSIDE the transaction it is handed, as the last database work before COMMIT:
 *  - a mutation's entry is written in the business transaction (the tx slot's audit hook, TASK-029), so neither
 *    exists without the other: if the write fails, the caller's transaction rolls back (O4);
 *  - a FAILED outcome (409/422/5xx after authorisation) and a best-effort or fail-closed VIEW are written by the caller
 *    in a SEPARATE short transaction after the business one rolled back or the result set was fixed (REQ-AUDIT-010,
 *    REQ-AUDIT-005); the writer is the same, only the transaction differs.
 * One call per entry with the COMPLETE entry: every personal value is tokenised in ONE batch before the stream lock
 * (one vault INSERT and one lookup, never one statement per value; D-ARCH-085), so the lock is held for two round
 * trips only.
 *
 * Failures are `AuditWriteError`: 503 AUDIT_LOCK_TIMEOUT (retryable, `Retry-After: 1`) for SQLSTATE 55P03, 500
 * AUDIT_WRITE_FAILED for everything else. The caller must let it propagate so the transaction rolls back; the API's
 * `withTenantTx` maps it to the problem response.
 */
import { randomInt } from 'node:crypto';

import { ANONYMOUS_ACTOR_ID, uuidv7 } from '@platform/shared';

import { type AuditEntryInput, type IpIndex, type PiiValue, type PreparedEntry, prepareEntry } from './entry.js';
import { AuditWriteError, toAuditWriteError } from './errors.js';
import type { AppendedEntry, AuditSqlPort, AuditStore } from './store/prisma-store.js';

/**
 * Turns personal values into vault tokens, in order, in ONE batch per entry (TASK-028 implements it with
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
  /** Writes one complete entry inside `db`'s transaction; returns its chain position. */
  write(db: AuditSqlPort, entry: AuditEntryInput): Promise<AppendedEntry>;
}

const SHARDS = 16;

export function createAuditWriter(options: AuditWriterOptions): AuditWriter {
  if (!Number.isInteger(options.lockTimeoutMs) || options.lockTimeoutMs < 1) {
    throw new RangeError('lockTimeoutMs must be a positive integer (DB_AUDIT_LOCK_TIMEOUT_MS)');
  }
  const newId = options.newId ?? uuidv7;
  const systemShard = options.systemShard ?? ((): number => randomInt(SHARDS));

  async function tokenise(db: AuditSqlPort, values: readonly PiiValue[]): Promise<readonly string[]> {
    if (values.length === 0) return [];
    if (options.tokeniser === undefined) throw new AuditWriteError('TOKENISER_UNAVAILABLE');
    try {
      return await options.tokeniser.tokenise(db, values);
    } catch (error) {
      throw toAuditWriteError(error, 'TOKENISER_FAILED');
    }
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
      throw error instanceof AuditWriteError ? error : new AuditWriteError('INVALID_ENTRY', { cause: error });
    }
  }

  async function write(db: AuditSqlPort, entry: AuditEntryInput): Promise<AppendedEntry> {
    const prepared = prepare(entry);
    const tokens = await tokenise(db, prepared.piiValues);
    const row = prepared.complete(tokens);
    try {
      return await options.store.append(db, row, { lockTimeoutMs: options.lockTimeoutMs, actorStamp: row.userId ?? ANONYMOUS_ACTOR_ID });
    } catch (error) {
      throw toAuditWriteError(error);
    }
  }

  return { write };
}
