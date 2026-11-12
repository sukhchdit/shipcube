/**
 * Database error mapping (ADR-0005 amendment 10 item 6, PR7-SEC-03; TASK-016).
 *
 * Driver errors are keyed on `meta.driverAdapterError.cause.originalCode` for every Prisma error that carries a
 * driver-adapter error (raw queries surface as `P2010`, model operations as `P2039`; the adapter's mapped kinds such as
 * `TransactionWriteConflict` have no `cause.code`). The PostgreSQL message, `detail` and `hint` name tables and values:
 * they are read only to classify an RLS `WITH CHECK` rejection and are never copied into a mapping or a `DbError`.
 */

/** Public RFC 9457 `code` of the problem response (the API error catalogue). */
export type DbProblemCode = 'AUTHZ_DENIED' | 'NOT_FOUND' | 'CONFLICT' | 'SERVICE_UNAVAILABLE' | 'INTERNAL_ERROR';

/** Stable machine reason for logs, metrics and tests. Never shown to end users as text. */
export type DbErrorReason =
  | 'RLS_WRITE_REJECTED'
  | 'DB_PRIVILEGE_DENIED'
  | 'TRANSACTION_UNAVAILABLE'
  | 'LOCK_TIMEOUT'
  | 'SERIALIZATION_FAILURE'
  | 'DEADLOCK_DETECTED'
  | 'STATEMENT_TIMEOUT'
  | 'DB_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'NESTED_TENANT_TX'
  | 'TENANT_TX_CLOSED'
  | 'INVALID_TENANT_CONTEXT'
  | 'DB_SESSION_CONTEXT_LEAK';

/** Security events raised by the data layer (sink injected by the composition root). */
export type DbSecurityEvent = 'rls_write_rejected' | 'db_privilege_denied' | 'db_session_context_leak';

export type DbErrorStatus = 403 | 404 | 409 | 500 | 503;

/** Safe, serialisable description of a database failure. Holds no PostgreSQL or Prisma text by construction. */
export interface DbErrorMapping {
  readonly status: DbErrorStatus;
  readonly code: DbProblemCode;
  readonly reason: DbErrorReason;
  readonly retryable: boolean;
  /** Seconds for the `Retry-After` header; present exactly when `retryable`. */
  readonly retryAfterSeconds?: number;
  readonly securityEvent?: DbSecurityEvent;
  /** Five-character SQLSTATE, when the failure came from PostgreSQL. */
  readonly sqlState?: string;
  /** Prisma error code (`P####`), when the failure came from Prisma. */
  readonly prismaCode?: string;
}

/** `Retry-After` for retryable database failures: one pool checkout / lock wait is short. */
export const DB_RETRY_AFTER_SECONDS = 1;

/** Prefix of PostgreSQL's RLS `WITH CHECK` rejection (as opposed to a missing privilege, also 42501). */
const RLS_WITH_CHECK_PREFIX = 'new row violates row-level security policy';
const SQLSTATE = /^[0-9A-Z]{5}$/;
const PRISMA_CODE = /^P\d{4}$/;

const STATUS_CODE: Readonly<Record<DbErrorStatus, DbProblemCode>> = {
  403: 'AUTHZ_DENIED',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

const RETRYABLE_SQLSTATES: Readonly<Record<string, DbErrorReason>> = {
  '55P03': 'LOCK_TIMEOUT',
  '40001': 'SERIALIZATION_FAILURE',
  '40P01': 'DEADLOCK_DETECTED',
  '57014': 'STATEMENT_TIMEOUT',
};

/**
 * Prisma codes that are retryable without a driver cause: `P2028` (pool checkout `maxWait` exceeded or transaction
 * expired, F-03) and `P2034` (Prisma's model-operation rendering of a write conflict or deadlock, 40001/40P01).
 */
const RETRYABLE_PRISMA_CODES: Readonly<Record<string, DbErrorReason>> = {
  P2028: 'TRANSACTION_UNAVAILABLE',
  P2034: 'SERIALIZATION_FAILURE',
};

/** Builds a mapping for a reason the data layer raises itself (no driver error involved). */
export function dbErrorMapping(
  status: DbErrorStatus,
  reason: DbErrorReason,
  extra: { readonly retryable?: boolean; readonly securityEvent?: DbSecurityEvent } = {},
): DbErrorMapping {
  const retryable = extra.retryable ?? false;
  return {
    status,
    code: STATUS_CODE[status],
    reason,
    retryable,
    ...(retryable ? { retryAfterSeconds: DB_RETRY_AFTER_SECONDS } : {}),
    ...(extra.securityEvent === undefined ? {} : { securityEvent: extra.securityEvent }),
  };
}

/**
 * Structured database error consumed by the problem+json handler (TASK-006). Its message is the reason only; it has
 * no `cause`, so a logger serialising it cannot reach the PostgreSQL text.
 */
export class DbError extends Error implements DbErrorMapping {
  readonly status: DbErrorStatus;
  readonly code: DbProblemCode;
  readonly reason: DbErrorReason;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly securityEvent?: DbSecurityEvent;
  readonly sqlState?: string;
  readonly prismaCode?: string;

  constructor(mapping: DbErrorMapping) {
    super(`Database error: ${mapping.reason}`);
    this.name = 'DbError';
    this.status = mapping.status;
    this.code = mapping.code;
    this.reason = mapping.reason;
    this.retryable = mapping.retryable;
    if (mapping.retryAfterSeconds !== undefined) this.retryAfterSeconds = mapping.retryAfterSeconds;
    if (mapping.securityEvent !== undefined) this.securityEvent = mapping.securityEvent;
    if (mapping.sqlState !== undefined) this.sqlState = mapping.sqlState;
    if (mapping.prismaCode !== undefined) this.prismaCode = mapping.prismaCode;
  }

  /** The safe mapping (what a log line or a problem response may carry). */
  toJSON(): DbErrorMapping {
    return {
      status: this.status,
      code: this.code,
      reason: this.reason,
      retryable: this.retryable,
      ...(this.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: this.retryAfterSeconds }),
      ...(this.securityEvent === undefined ? {} : { securityEvent: this.securityEvent }),
      ...(this.sqlState === undefined ? {} : { sqlState: this.sqlState }),
      ...(this.prismaCode === undefined ? {} : { prismaCode: this.prismaCode }),
    };
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const found = field(value, key);
  return typeof found === 'string' ? found : undefined;
}

/** `meta.driverAdapterError.cause` of a Prisma error, if any. */
function driverCause(error: unknown): unknown {
  return field(field(field(error, 'meta'), 'driverAdapterError'), 'cause');
}

/** True for errors raised by Prisma or its driver adapter (as opposed to application errors thrown by a callback). */
export function isDatabaseError(error: unknown): boolean {
  if (error instanceof DbError) return true;
  if (driverCause(error) !== undefined) return true;
  const code = stringField(error, 'code');
  if (code !== undefined && PRISMA_CODE.test(code)) return true;
  const name = stringField(error, 'name');
  return name !== undefined && (name.startsWith('PrismaClient') || name === 'DriverAdapterError');
}

/** Maps any thrown value to a safe {@link DbErrorMapping}. Pure; never copies message, detail, hint or meta. */
export function mapDbError(error: unknown): DbErrorMapping {
  if (error instanceof DbError) return error.toJSON();
  const rawPrismaCode = stringField(error, 'code');
  const prismaCode = rawPrismaCode !== undefined && PRISMA_CODE.test(rawPrismaCode) ? rawPrismaCode : undefined;
  const withPrisma = (mapping: DbErrorMapping): DbErrorMapping => (prismaCode === undefined ? mapping : { ...mapping, prismaCode });

  const cause = driverCause(error);
  const originalCode = stringField(cause, 'originalCode');
  if (originalCode !== undefined && SQLSTATE.test(originalCode)) {
    const withState = (mapping: DbErrorMapping): DbErrorMapping => withPrisma({ ...mapping, sqlState: originalCode });
    if (originalCode === '42501') {
      const text = stringField(cause, 'originalMessage') ?? stringField(cause, 'message') ?? '';
      return text.startsWith(RLS_WITH_CHECK_PREFIX)
        ? withState(dbErrorMapping(403, 'RLS_WRITE_REJECTED', { securityEvent: 'rls_write_rejected' }))
        : withState(dbErrorMapping(500, 'DB_PRIVILEGE_DENIED', { securityEvent: 'db_privilege_denied' }));
    }
    const retryReason = RETRYABLE_SQLSTATES[originalCode];
    if (retryReason !== undefined) return withState(dbErrorMapping(503, retryReason, { retryable: true }));
    return withState(dbErrorMapping(500, 'DB_ERROR'));
  }

  const prismaRetry = prismaCode === undefined ? undefined : RETRYABLE_PRISMA_CODES[prismaCode];
  if (prismaRetry !== undefined) return withPrisma(dbErrorMapping(503, prismaRetry, { retryable: true }));
  return withPrisma(dbErrorMapping(500, 'DB_ERROR'));
}

/** `mapDbError` as a throwable {@link DbError}. */
export function toDbError(error: unknown): DbError {
  return error instanceof DbError ? error : new DbError(mapDbError(error));
}
