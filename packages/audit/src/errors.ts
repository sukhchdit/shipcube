/**
 * Audit write error model (REQ-AUDIT-004, ADR-0007 §Capture and amendment 10 item 2; data-model §5.4 "Error model";
 * TASK-025). Two outcomes, and in both the business transaction rolls back, so nothing persists without its entry (O4):
 *
 *  - `AUDIT_LOCK_TIMEOUT`: SQLSTATE 55P03 while the writer runs (the stream's head-row lock, or the partition lock
 *    behind `ensure_audit_partitions` DDL, was not granted within `DB_AUDIT_LOCK_TIMEOUT_MS`): 503, retryable,
 *    `Retry-After: 1`.
 *  - `AUDIT_WRITE_FAILED`: anything else (invalid entry, missing tokeniser, head moved under the lock, no partition for
 *    `occurred_at`, integrity, any other database failure): 500, non-retryable.
 *
 * The error carries no PostgreSQL or Prisma text: its message is the reason and kind only, and the original failure is
 * kept outside the object (`auditErrorCause`), so a logger serialising the error cannot reach the server message. The
 * API's `withTenantTx` translates it into its `DbError` (apps/api/src/platform/db/with-tenant-tx.ts) and hands the
 * original to the redacting `onDbError` log hook.
 *
 * Callers must let it propagate out of the transaction callback. Swallowing it would let the business change commit
 * without its entry whenever the failure happened before PostgreSQL aborted the transaction (an invalid entry, a
 * missing tokeniser, a moved head).
 */

/** Public outcome: the reason the API maps to its problem response. */
export type AuditErrorReason = 'AUDIT_WRITE_FAILED' | 'AUDIT_LOCK_TIMEOUT';

/** Why the write failed, for logs and metrics only (never shown to a client). */
export type AuditFailureKind =
  /** The entry violates the entry contract (a programming error in the caller). */
  | 'INVALID_ENTRY'
  /** The entry carries personal values but no tokeniser is configured (fail closed, never written in clear). */
  | 'TOKENISER_UNAVAILABLE'
  /** The tokeniser returned a token list that does not match the value list. */
  | 'TOKENISER_FAILED'
  /** The `ip_hash` index threw or returned a malformed key id or digest (an infrastructure fault, not the caller's; R1-n4). */
  | 'IP_INDEX_FAILED'
  /** The stream head moved under the lock (expectAffected(1) mismatch; impossible unless the head was tampered with). */
  | 'HEAD_MOVED'
  /** The head row is missing after it was created (impossible unless the head was deleted concurrently). */
  | 'HEAD_MISSING'
  /** No `audit_entries` partition covers `occurred_at` (no DEFAULT partition, §5.1): fail closed. */
  | 'PARTITION_MISSING'
  /** SQLSTATE 55P03 while the writer ran. */
  | 'LOCK_TIMEOUT'
  /** Any other database failure. */
  | 'DATABASE_ERROR';

/** `Retry-After` seconds of a lock timeout (one lock wait is short; ADR-0007 am. 10 item 2). */
export const AUDIT_RETRY_AFTER_SECONDS = 1;

const causes = new WeakMap<AuditWriteError, unknown>();

/**
 * Brand of every `AuditWriteError` (R1-n6): a registry symbol, so {@link isAuditWriteError} also recognises an error
 * built by a second copy of this module (source and dist loaded side by side), where `instanceof` would not. The brand
 * is a cross-copy marker, not an authenticity check: in-process code can forge it, which only maps that object to the
 * generic 500 / 503 audit failure (PR #42 R2-n3).
 */
const BRAND = Symbol.for('platform.audit.AuditWriteError');

export class AuditWriteError extends Error {
  readonly reason: AuditErrorReason;
  readonly kind: AuditFailureKind;
  readonly status: 500 | 503;
  readonly retryable: boolean;
  /** Present exactly when `retryable`. */
  readonly retryAfterSeconds?: number;
  /** Five-character SQLSTATE, when the failure came from PostgreSQL. */
  readonly sqlState?: string;
  /** For INVALID_ENTRY: the offending entry field as a path (`origin.ip`, `newValue.items[2]`), never its value. */
  readonly field?: string;

  constructor(kind: AuditFailureKind, options: { readonly sqlState?: string; readonly field?: string; readonly cause?: unknown } = {}) {
    const reason: AuditErrorReason = kind === 'LOCK_TIMEOUT' ? 'AUDIT_LOCK_TIMEOUT' : 'AUDIT_WRITE_FAILED';
    super(`Audit write failed: ${reason} (${kind})`);
    this.name = 'AuditWriteError';
    this.reason = reason;
    this.kind = kind;
    this.status = reason === 'AUDIT_LOCK_TIMEOUT' ? 503 : 500;
    this.retryable = reason === 'AUDIT_LOCK_TIMEOUT';
    if (this.retryable) this.retryAfterSeconds = AUDIT_RETRY_AFTER_SECONDS;
    if (options.sqlState !== undefined) this.sqlState = options.sqlState;
    if (options.field !== undefined) this.field = options.field;
    if (options.cause !== undefined) causes.set(this, options.cause);
    Object.defineProperty(this, BRAND, { value: true });
  }

  /** The safe view (what a log line may carry). */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      reason: this.reason,
      kind: this.kind,
      status: this.status,
      retryable: this.retryable,
      ...(this.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: this.retryAfterSeconds }),
      ...(this.sqlState === undefined ? {} : { sqlState: this.sqlState }),
      ...(this.field === undefined ? {} : { field: this.field }),
    };
  }
}

export function isAuditWriteError(value: unknown): value is AuditWriteError {
  return typeof value === 'object' && value !== null && Reflect.get(value, BRAND) === true;
}

/** The original failure behind an `AuditWriteError`, for the redacting server log only (never a response). */
export function auditErrorCause(error: AuditWriteError): unknown {
  return causes.get(error);
}

const SQLSTATE = /^[0-9A-Z]{5}$/;
/** PostgreSQL's message for a row no partition accepts (`lc_messages = 'C'` for platform_app; prefix only, never copied). */
const NO_PARTITION_PREFIX = 'no partition of relation';

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function text(value: unknown, key: string): string | undefined {
  const found = field(value, key);
  return typeof found === 'string' ? found : undefined;
}

/**
 * SQLSTATE and server message of a database failure: a Prisma driver-adapter error
 * (`meta.driverAdapterError.cause.{originalCode, originalMessage}`) or a plain `pg` error (`code`, `message`).
 */
function databaseFailure(error: unknown): { readonly sqlState?: string; readonly message: string } {
  const cause = field(field(field(error, 'meta'), 'driverAdapterError'), 'cause');
  const adapterCode = text(cause, 'originalCode');
  if (adapterCode !== undefined && SQLSTATE.test(adapterCode)) {
    return { sqlState: adapterCode, message: text(cause, 'originalMessage') ?? text(cause, 'message') ?? '' };
  }
  const code = text(error, 'code');
  if (code !== undefined && SQLSTATE.test(code)) return { sqlState: code, message: text(error, 'message') ?? '' };
  return { message: '' };
}

/**
 * Classifies a failure thrown during the write; an `AuditWriteError` passes through unchanged. A failure that carries
 * no SQLSTATE is reported as `fallback` (the tokeniser's own failures are `TOKENISER_FAILED`, the store's
 * `DATABASE_ERROR`).
 */
export function toAuditWriteError(error: unknown, fallback: AuditFailureKind = 'DATABASE_ERROR'): AuditWriteError {
  if (isAuditWriteError(error)) return error;
  const { sqlState, message } = databaseFailure(error);
  if (sqlState === undefined) return new AuditWriteError(fallback, { cause: error });
  const options = { sqlState, cause: error };
  if (sqlState === '55P03') return new AuditWriteError('LOCK_TIMEOUT', options);
  if (sqlState === '23514' && message.startsWith(NO_PARTITION_PREFIX)) return new AuditWriteError('PARTITION_MISSING', options);
  return new AuditWriteError('DATABASE_ERROR', options);
}
