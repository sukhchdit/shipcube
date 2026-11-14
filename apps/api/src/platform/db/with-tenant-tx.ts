/**
 * `withTenantTx`: every request or job database access runs in a Prisma interactive transaction whose first statement
 * sets the transaction-local tenant context (ADR-0005 §Transaction-scoped context, amendment 10 items 2-4, 8, 12, 16;
 * data-model §4.1; US-075; TASK-016).
 *
 * This is the only application module allowed to contain the context tokens (ADR-0005 am. 10 item 1, lint exemption).
 * The context statement is the data-model §4.1 eight-setting statement: it reads the prior values of the four security
 * keys in a `MATERIALIZED` CTE (session-leak detector, item 16) and sets every value with `set_config(name, $n, true)`
 * in one round trip. `is_local` is the literal `true`; each `$n` is a validated string.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

import type { Config } from '@platform/config';

import { DbError, type DbErrorMapping, dbErrorMapping, type DbSecurityEvent, isDatabaseError, mapDbError } from './map-db-error.js';
import { createTenantDb, type TenantDb } from './tenant-db.js';

export type ActorScope = 'TENANT' | 'OPERATOR';

/** Request or job context; every field is validated before any database call. */
export interface TenantContext {
  /** Active organisation UUID, or '' (guest/public). */
  readonly orgId: string;
  /** User or SYSTEM actor UUID, or '' (anonymous). */
  readonly actorId: string;
  readonly actorScope: ActorScope;
  /** `guestTokenHash(token)` (64 lowercase hex), or ''. Never client-supplied hex (item 8). */
  readonly guestTokenHash: string;
  readonly correlationId: string;
}

/** Minimal raw-query surface of a Prisma client or transaction client. */
export interface RawQueryClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

export interface TransactionOptions {
  readonly maxWait: number;
  readonly timeout: number;
}

/** The root client shape the factory needs (a generated `PrismaClient`, possibly extended, item 5). */
export interface TransactionCapableClient<TTx> extends RawQueryClient {
  $transaction<R>(fn: (tx: TTx) => Promise<R>, options?: { maxWait?: number; timeout?: number }): Promise<R>;
}

export interface WithTenantTxOptions {
  /** `DB_TX_STATEMENT_TIMEOUT_MS`: transaction-local `statement_timeout`. */
  readonly statementTimeoutMs: number;
  /** `DB_TX_LOCK_TIMEOUT_MS`: transaction-local `lock_timeout`. */
  readonly lockTimeoutMs: number;
  /** `DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS`: transaction-local `idle_in_transaction_session_timeout`. */
  readonly idleInTransactionTimeoutMs: number;
  /** The pool's `connectionTimeoutMillis` (`DB_CONNECTION_TIMEOUT_MS`); `maxWaitMs` may not exceed it. */
  readonly poolConnectionTimeoutMs: number;
  /** Prisma `maxWait` (pool-checkout budget). Default 2 000 ms. */
  readonly maxWaitMs?: number;
  /** Prisma interactive-transaction `timeout`; must be ≥ `statementTimeoutMs`. Default `statementTimeoutMs`. */
  readonly timeoutMs?: number;
}

/**
 * The validated actor and organisation of one tenant transaction, as the standard-columns extension records them
 * (TASK-032, data-model §7.6): lowercase UUIDs or '' (anonymous / no active organisation), exactly the values the
 * context statement sets as `app.actor_id` / `app.org_id`.
 */
export interface TransactionStamp {
  readonly orgId: string;
  readonly actorId: string;
}

export interface SecurityEventDetail {
  readonly correlationId?: string;
  readonly sqlState?: string;
}

export interface WithTenantTxDeps<TTx = unknown> {
  /** Security-event sink (no sink on main yet; ADR-0005 am. 10 items 6 and 16). */
  readonly onSecurityEvent: (event: DbSecurityEvent, detail: SecurityEventDetail) => void;
  /** Increments the `db_session_context_leak` counter. */
  readonly countSessionContextLeak: () => void;
  /** Marks the process not-ready until restart (a leaked backend stays in the process-scoped pool). */
  readonly markNotReady: (reason: 'db_session_context_leak') => void;
  /** Environment checked for `PGOPTIONS`; defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Redacting log hook for the ORIGINAL database error before it is replaced by its DbError (TASK-010, PR #11
   * DEFERRED item; AT-US-007-03 "full error in the server log"). The runtime passes it to the platform logger, whose
   * serializer writes database errors as `{ name, code, originalCode, kind }` only (PR7-SEC-03 item 3). The error never
   * becomes a `cause` of the DbError. A throwing hook never masks the mapped error.
   */
  readonly onDbError?: (error: unknown, mapping: DbErrorMapping) => void;
  /**
   * Per-transaction client (ADR-0005 am. 10 item 5, data-model §7.6; TASK-032): the root client extended with the
   * standard-columns extension bound to `stamp` (`withStandardColumns`). The transaction is opened on the returned
   * client, so the stamping runs inside it; the stamp comes from this closure, never from AsyncLocalStorage. REQUIRED
   * (PR26-SEC-02): an unscoped fallback to the root client would persist caller-supplied server columns and skip the
   * version bump on updates. A caller that deliberately wants the plain client passes `() => client`.
   */
  readonly scopeClient: (stamp: TransactionStamp) => TransactionCapableClient<TTx>;
}

/** Per-call options of `withTenantTx` (TASK-020 part 020-C). */
export interface TenantTxCallOptions {
  /**
   * `true`: the transaction is READ ONLY (`SET TRANSACTION READ ONLY` right after the context statement), so any
   * write fails with SQLSTATE 25006; the `load` route phase runs this way (ADR-0003 amendment 2026-11-13, D-ARCH-106).
   */
  readonly readOnly?: boolean;
}

export interface TenantTxRunner<TTx> {
  /** Runs `fn` in a tenant transaction; `fn` receives the guarded `TenantDb`, never the raw transaction client. */
  withTenantTx<R>(ctx: TenantContext, fn: (db: TenantDb<TTx>) => Promise<R>, options?: TenantTxCallOptions): Promise<R>;
  /** Start-up probe: every `app.*` setting must be NULL or '' on a fresh connection (item 4). */
  probeFreshConnection(): Promise<void>;
  /** The resolved `{ maxWait, timeout }` passed to every `$transaction`. */
  readonly transactionOptions: TransactionOptions;
}

export class TenantTxConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantTxConfigError';
  }
}

export const DEFAULT_MAX_WAIT_MS = 2_000;

/**
 * The data-model §4.1 statement in bind-parameter form. The tagged template in {@link setTenantContext} renders to
 * exactly this text (unit-tested); integration tests EXPLAIN it to assert the server-side cost.
 */
export const CONTEXT_STATEMENT_SQL = `WITH prev AS MATERIALIZED (
  SELECT current_setting('app.org_id', true) AS org_id,
         current_setting('app.actor_id', true) AS actor_id,
         current_setting('app.actor_scope', true) AS actor_scope,
         current_setting('app.guest_token_hash', true) AS guest_token_hash)
SELECT prev.*,
       set_config('app.org_id', $1, true) AS set_org_id,
       set_config('app.actor_id', $2, true) AS set_actor_id,
       set_config('app.actor_scope', $3, true) AS set_actor_scope,
       set_config('app.guest_token_hash', $4, true) AS set_guest_token_hash,
       set_config('app.correlation_id', $5, true) AS set_correlation_id,
       set_config('statement_timeout', $6, true) AS set_statement_timeout,
       set_config('lock_timeout', $7, true) AS set_lock_timeout,
       set_config('idle_in_transaction_session_timeout', $8, true) AS set_idle_in_transaction_session_timeout
  FROM prev`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUEST_TOKEN_HASH = /^[0-9a-f]{64}$/;
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const ACTOR_SCOPES: ReadonlySet<string> = new Set<ActorScope>(['TENANT', 'OPERATOR']);

/** Re-entrance marker: set for the whole async extent of a tenant transaction (item 2, AT-US-075-04). */
const tenantTxScope = new AsyncLocalStorage<true>();

/** True inside the async extent of a `withTenantTx` callback. */
export function isInsideTenantTx(): boolean {
  return tenantTxScope.getStore() === true;
}

/** Server-side guest token hash: lowercase hex SHA-256 of the presented token (item 8, F-08). */
export function guestTokenHash(token: string): string {
  if (token.length === 0) throw new TypeError('guestTokenHash: token must not be empty');
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The eight bind values of the context statement, in `$1..$8` order. */
export type ContextValues = readonly [string, string, string, string, string, string, string, string];

const invalidContext = (): DbError => new DbError(dbErrorMapping(500, 'INVALID_TENANT_CONTEXT'));

function uuidOrEmpty(value: unknown): string {
  if (value === '') return '';
  if (typeof value !== 'string' || !UUID.test(value)) throw invalidContext();
  return value.toLowerCase();
}

/** Validates a context and returns the bind values. Throws `INVALID_TENANT_CONTEXT` (500) without echoing any value. */
export function contextValues(
  ctx: TenantContext,
  options: Pick<WithTenantTxOptions, 'statementTimeoutMs' | 'lockTimeoutMs' | 'idleInTransactionTimeoutMs'>,
): ContextValues {
  if (typeof ctx !== 'object' || ctx === null) throw invalidContext();
  const orgId = uuidOrEmpty(ctx.orgId);
  const actorId = uuidOrEmpty(ctx.actorId);
  if (typeof ctx.actorScope !== 'string' || !ACTOR_SCOPES.has(ctx.actorScope)) throw invalidContext();
  const hash = ctx.guestTokenHash;
  if (typeof hash !== 'string' || (hash !== '' && !GUEST_TOKEN_HASH.test(hash))) throw invalidContext();
  if (typeof ctx.correlationId !== 'string' || !CORRELATION_ID.test(ctx.correlationId)) throw invalidContext();
  return [
    orgId,
    actorId,
    ctx.actorScope,
    hash,
    ctx.correlationId,
    String(options.statementTimeoutMs),
    String(options.lockTimeoutMs),
    String(options.idleInTransactionTimeoutMs),
  ];
}

interface PreviousContext {
  readonly org_id: string | null;
  readonly actor_id: string | null;
  readonly actor_scope: string | null;
  readonly guest_token_hash: string | null;
}

const isUnset = (value: unknown): boolean => value === null || value === undefined || value === '';

/** True when any prior security key holds a value other than NULL or '' (F-07 reset value): a session-level leak. */
export function hasLeakedContext(prev: Partial<PreviousContext> | undefined): boolean {
  if (prev === undefined) return true;
  return !(isUnset(prev.org_id) && isUnset(prev.actor_id) && isUnset(prev.actor_scope) && isUnset(prev.guest_token_hash));
}

/** Runs the §4.1 statement on `tx` and returns the prior values (one round trip; `$queryRaw`, tagged template). */
async function setTenantContext(tx: RawQueryClient, values: ContextValues): Promise<PreviousContext | undefined> {
  const [orgId, actorId, actorScope, hash, correlationId, statementTimeout, lockTimeout, idleTimeout] = values;
  const rows = await tx.$queryRaw<PreviousContext[]>`WITH prev AS MATERIALIZED (
  SELECT current_setting('app.org_id', true) AS org_id,
         current_setting('app.actor_id', true) AS actor_id,
         current_setting('app.actor_scope', true) AS actor_scope,
         current_setting('app.guest_token_hash', true) AS guest_token_hash)
SELECT prev.*,
       set_config('app.org_id', ${orgId}, true) AS set_org_id,
       set_config('app.actor_id', ${actorId}, true) AS set_actor_id,
       set_config('app.actor_scope', ${actorScope}, true) AS set_actor_scope,
       set_config('app.guest_token_hash', ${hash}, true) AS set_guest_token_hash,
       set_config('app.correlation_id', ${correlationId}, true) AS set_correlation_id,
       set_config('statement_timeout', ${statementTimeout}, true) AS set_statement_timeout,
       set_config('lock_timeout', ${lockTimeout}, true) AS set_lock_timeout,
       set_config('idle_in_transaction_session_timeout', ${idleTimeout}, true) AS set_idle_in_transaction_session_timeout
  FROM prev`;
  return rows.length === 1 ? rows[0] : undefined;
}

/**
 * The `app.*` settings the context statement writes. Placeholder GUCs are flagged `GUC_NO_SHOW_ALL`, so `pg_settings`
 * never lists them (proved by the session-scope integration test): the probe reads each known name instead.
 */
export const APP_SETTING_NAMES = Object.freeze([
  'app.actor_id',
  'app.actor_scope',
  'app.correlation_id',
  'app.guest_token_hash',
  'app.org_id',
] as const);

/**
 * Finds `app.*` settings that carry a value on the connection that runs the query (item 4). Returns the names of
 * leaked settings (never their values); an empty list means clean.
 */
export async function findSessionContext(db: RawQueryClient): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ name: string }>>`SELECT k.name
      FROM unnest(${[...APP_SETTING_NAMES]}::text[]) AS k(name)
     WHERE coalesce(current_setting(k.name, true), '') <> ''
     ORDER BY k.name`;
  return rows.map((row) => row.name);
}

function positiveInt(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new TenantTxConfigError(`${name} must be a positive integer (ms)`);
  }
  return value;
}

/** Validates the options and resolves `{ maxWait, timeout }` (item 3). */
export function resolveTransactionOptions(options: WithTenantTxOptions): TransactionOptions {
  const statement = positiveInt('statementTimeoutMs', options.statementTimeoutMs);
  positiveInt('lockTimeoutMs', options.lockTimeoutMs);
  positiveInt('idleInTransactionTimeoutMs', options.idleInTransactionTimeoutMs);
  const pool = positiveInt('poolConnectionTimeoutMs', options.poolConnectionTimeoutMs);
  const maxWait = positiveInt('maxWaitMs', options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);
  const timeout = positiveInt('timeoutMs', options.timeoutMs ?? statement);
  if (maxWait > pool) throw new TenantTxConfigError('maxWaitMs must not exceed the pool connectionTimeoutMillis');
  if (timeout < statement) throw new TenantTxConfigError('timeoutMs must be at least statementTimeoutMs');
  return { maxWait, timeout };
}

/** Maps the validated configuration onto the factory options. */
export function tenantTxOptionsFromConfig(
  config: Pick<
    Config,
    'DB_TX_STATEMENT_TIMEOUT_MS' | 'DB_TX_LOCK_TIMEOUT_MS' | 'DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS' | 'DB_CONNECTION_TIMEOUT_MS'
  >,
): WithTenantTxOptions {
  return {
    statementTimeoutMs: config.DB_TX_STATEMENT_TIMEOUT_MS,
    lockTimeoutMs: config.DB_TX_LOCK_TIMEOUT_MS,
    idleInTransactionTimeoutMs: config.DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    poolConnectionTimeoutMs: config.DB_CONNECTION_TIMEOUT_MS,
  };
}

/**
 * Refuses `PGOPTIONS` (item 4, PR9-SEC-03): libpq-style session options (`-c lock_timeout=0`, a preset `app.` key)
 * would apply to every pooled connection and bypass the per-transaction context. The composition root
 * (`./runtime.ts`) calls this with `process.env` before it builds a pool; `createWithTenantTx` calls it again.
 */
export function assertNoSessionOptions(env: Readonly<Record<string, string | undefined>>): void {
  if (env['PGOPTIONS'] !== undefined) {
    throw new TenantTxConfigError('PGOPTIONS must not be set: session options would bypass the per-transaction context');
  }
}

/**
 * Builds the tenant-transaction runner over the root client. The root client stays inside this closure: it is never
 * returned, and the callback receives only the `TenantDb` guard (item 2).
 */
export function createWithTenantTx<TTx extends RawQueryClient>(
  client: TransactionCapableClient<TTx>,
  options: WithTenantTxOptions,
  deps: WithTenantTxDeps<TTx>,
): TenantTxRunner<TTx> {
  assertNoSessionOptions(deps.env ?? process.env);
  const transactionOptions = Object.freeze(resolveTransactionOptions(options));
  const timeouts = {
    statementTimeoutMs: options.statementTimeoutMs,
    lockTimeoutMs: options.lockTimeoutMs,
    idleInTransactionTimeoutMs: options.idleInTransactionTimeoutMs,
  };

  const reportLeak = (correlationId?: string): DbError => {
    deps.countSessionContextLeak();
    deps.onSecurityEvent('db_session_context_leak', correlationId === undefined ? {} : { correlationId });
    deps.markNotReady('db_session_context_leak');
    return new DbError(dbErrorMapping(500, 'DB_SESSION_CONTEXT_LEAK', { securityEvent: 'db_session_context_leak' }));
  };

  const mapped = (error: unknown, correlationId: string): unknown => {
    if (error instanceof DbError || !isDatabaseError(error)) return error;
    const mapping: DbErrorMapping = mapDbError(error);
    if (deps.onDbError !== undefined) {
      try {
        deps.onDbError(error, mapping);
      } catch {
        // Logging is best effort here: the caller must still receive the mapped DbError, never the original error.
      }
    }
    if (mapping.securityEvent !== undefined) {
      deps.onSecurityEvent(mapping.securityEvent, {
        correlationId,
        ...(mapping.sqlState === undefined ? {} : { sqlState: mapping.sqlState }),
      });
    }
    return new DbError(mapping);
  };

  async function withTenantTx<R>(ctx: TenantContext, fn: (db: TenantDb<TTx>) => Promise<R>, call?: TenantTxCallOptions): Promise<R> {
    if (isInsideTenantTx()) throw new DbError(dbErrorMapping(500, 'NESTED_TENANT_TX'));
    const values = contextValues(ctx, timeouts);
    const correlationId = values[4];
    const txClient = deps.scopeClient({ orgId: values[0], actorId: values[1] });
    try {
      return await tenantTxScope.run(true, () =>
        txClient.$transaction(async (tx) => {
          const prev = await setTenantContext(tx, values);
          if (hasLeakedContext(prev)) throw reportLeak(correlationId);
          if (call?.readOnly === true) await tx.$queryRaw`SET TRANSACTION READ ONLY`;
          const handle = createTenantDb(tx);
          try {
            return await fn(handle.db);
          } finally {
            handle.revoke();
          }
        }, transactionOptions),
      );
    } catch (error) {
      throw mapped(error, correlationId);
    }
  }

  async function probeFreshConnection(): Promise<void> {
    if (isInsideTenantTx()) throw new DbError(dbErrorMapping(500, 'NESTED_TENANT_TX'));
    const leaked = await findSessionContext(client);
    if (leaked.length > 0) throw reportLeak();
  }

  return { withTenantTx, probeFreshConnection, transactionOptions };
}
