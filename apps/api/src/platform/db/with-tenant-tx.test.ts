import { randomUUID } from 'node:crypto';

import { describe, expect, it, jest } from '@jest/globals';
import { type AppendedEntry, type AuditEntryInput, type AuditStore, AuditWriteError, createAuditWriter, pii } from '@platform/audit';
import { DB_CONNECTION_TIMEOUT_MS_MIN, DB_TENANT_ADMISSION_WAIT_MS_MAX } from '@platform/config';

import { DbError, type DbSecurityEvent } from './map-db-error.js';
import type { TenantDb } from './tenant-db.js';
import {
  APP_SETTING_NAMES,
  CONTEXT_STATEMENT_SQL,
  contextValues,
  createWithTenantTx,
  DEFAULT_MAX_WAIT_MS,
  findSessionContext,
  guestTokenHash,
  hasLeakedContext,
  isInsideTenantTx,
  resolveAdmissionOptions,
  resolveTransactionOptions,
  type SecurityEventDetail,
  type TenantContext,
  tenantTxOptionsFromConfig,
  TenantTxConfigError,
  type WithTenantTxOptions,
} from './with-tenant-tx.js';

interface RawCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

type Row = Record<string, string | null>;

/** Renders a tagged-template call the way the driver sees it: `$1..$n` placeholders. */
const render = (strings: TemplateStringsArray): string => strings.reduce((sql, part, i) => `${sql}$${String(i)}${part}`);

class FakeTx {
  readonly calls: RawCall[] = [];
  constructor(private readonly prev: Row | undefined) {}
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
    this.calls.push({ sql: render(strings), values });
    return Promise.resolve((this.prev === undefined ? [] : [this.prev]) as T);
  }
  $executeRaw(strings: TemplateStringsArray): Promise<number> {
    // A statement marked slow answers a macrotask later, like a real round trip (PR42-SEC-17 statement tracking).
    if (strings.join('').includes('slow')) return new Promise((resolve) => setTimeout(() => resolve(strings.length), 10));
    return Promise.resolve(strings.length);
  }
  $transaction(): Promise<string> {
    return Promise.resolve('savepoint');
  }
}

interface FakeOptions {
  readonly prev?: Row | undefined;
  readonly transactionError?: Error;
  readonly settings?: string[];
}

const CLEAN: Row = { org_id: null, actor_id: null, actor_scope: null, guest_token_hash: null };

function fakeClient(options: FakeOptions = {}) {
  const tx = new FakeTx('prev' in options ? options.prev : CLEAN);
  const transactions: Array<{ maxWait?: number; timeout?: number } | undefined> = [];
  const rootCalls: RawCall[] = [];
  const client = {
    async $transaction<R>(fn: (inner: FakeTx) => Promise<R>, txOptions?: { maxWait?: number; timeout?: number }): Promise<R> {
      transactions.push(txOptions);
      if (options.transactionError !== undefined) throw options.transactionError;
      return fn(tx);
    },
    $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
      rootCalls.push({ sql: render(strings), values });
      return Promise.resolve((options.settings ?? []).map((name) => ({ name })) as T);
    },
  };
  return { client, tx, transactions, rootCalls };
}

function fakeDeps() {
  const events: Array<[DbSecurityEvent, SecurityEventDetail]> = [];
  const deps = {
    onSecurityEvent: (event: DbSecurityEvent, detail: SecurityEventDetail): void => {
      events.push([event, detail]);
    },
    countSessionContextLeak: jest.fn<() => void>(),
    markNotReady: jest.fn<(reason: 'db_session_context_leak') => void>(),
    env: {} as Record<string, string | undefined>,
  };
  return { deps, events };
}

const OPTIONS: WithTenantTxOptions = {
  statementTimeoutMs: 5_000,
  lockTimeoutMs: 2_000,
  idleInTransactionTimeoutMs: 15_000,
  poolConnectionTimeoutMs: 5_000,
};

const ORG = randomUUID();
const ACTOR = randomUUID();
const ctx = (overrides: Partial<Record<keyof TenantContext, unknown>> = {}): TenantContext =>
  ({ orgId: ORG, actorId: ACTOR, actorScope: 'TENANT', guestTokenHash: '', correlationId: 'req-1', ...overrides }) as TenantContext;

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

function setup(options: FakeOptions = {}, txOptions: WithTenantTxOptions = OPTIONS) {
  const fake = fakeClient(options);
  const { deps, events } = fakeDeps();
  const runner = createWithTenantTx(fake.client, txOptions, { ...deps, scopeClient: () => fake.client });
  return { ...fake, deps, events, runner };
}

describe('withTenantTx context statement (data-model §4.1; ADR-0005 am.10 items 4, 12, 16)', () => {
  it('ADR-0005 am.10 item 16: runs exactly the eight-setting statement with the MATERIALIZED prev CTE as its first and only round trip', async () => {
    const { runner, tx } = setup();
    await runner.withTenantTx(ctx(), () => Promise.resolve('ok'));
    expect(tx.calls).toHaveLength(1);
    const [call] = tx.calls;
    expect(call?.sql).toBe(CONTEXT_STATEMENT_SQL);
    expect(CONTEXT_STATEMENT_SQL).toMatch(/^WITH prev AS MATERIALIZED \(/);
    expect(CONTEXT_STATEMENT_SQL.match(/set_config\('[a-z_.]+', \$\d, true\)/g)).toHaveLength(8);
    expect(CONTEXT_STATEMENT_SQL).not.toMatch(/set_config\([^)]*(false|NULL)/i);
  });

  it('ADR-0005 am.10 items 4 and 12: binds eight validated strings, the timeouts from the options, never NULL/undefined/Sql', async () => {
    const { runner, tx } = setup(
      {},
      { ...OPTIONS, statementTimeoutMs: 250, lockTimeoutMs: 300, idleInTransactionTimeoutMs: 1_500, timeoutMs: 10_000 },
    );
    const hash = guestTokenHash('quote-token');
    await runner.withTenantTx(ctx({ orgId: ORG.toUpperCase(), guestTokenHash: hash, actorScope: 'OPERATOR' }), () => Promise.resolve());
    expect(tx.calls[0]?.values).toEqual([ORG, ACTOR, 'OPERATOR', hash, 'req-1', '250', '300', '1500']);
    for (const value of tx.calls[0]?.values ?? []) expect(typeof value).toBe('string');
  });

  it('ADR-0005 am.10 item 3: passes explicit { maxWait, timeout } to every $transaction', async () => {
    const defaults = setup();
    await defaults.runner.withTenantTx(ctx(), () => Promise.resolve());
    expect(defaults.transactions).toEqual([{ maxWait: DEFAULT_MAX_WAIT_MS, timeout: 5_000 }]);
    expect(defaults.runner.transactionOptions).toEqual({ maxWait: 2_000, timeout: 5_000 });
    const custom = setup({}, { ...OPTIONS, maxWaitMs: 500, timeoutMs: 8_000 });
    await custom.runner.withTenantTx(ctx(), () => Promise.resolve());
    expect(custom.transactions).toEqual([{ maxWait: 500, timeout: 8_000 }]);
  });

  it('ADR-0005 am.10 item 1: the callback receives the TenantDb guard, never the raw transaction client', async () => {
    const { runner, tx } = setup();
    let seen: TenantDb<FakeTx> | undefined;
    await runner.withTenantTx(ctx(), (db) => {
      seen = db;
      expect(db).not.toBe(tx);
      expect(() => (db as unknown as FakeTx).$transaction()).toThrow('TenantDb does not expose $transaction');
      return db.$executeRaw`SELECT 1`;
    });
    // revoked once the transaction settles: a leaked handle cannot run on a closed transaction
    expect(() => seen?.$executeRaw).toThrow('Database error: TENANT_TX_CLOSED');
  });
});

describe('withTenantTx guards that throw before reaching the database', () => {
  it('AT-US-075-04: a nested withTenantTx throws NESTED_TENANT_TX before any query; the outer transaction continues', async () => {
    const { runner, tx, transactions } = setup();
    const result = await runner.withTenantTx(ctx(), async () => {
      expect(isInsideTenantTx()).toBe(true);
      const nested = await caught(runner.withTenantTx(ctx({ orgId: randomUUID() }), () => Promise.resolve('inner')));
      expect(nested).toBeInstanceOf(DbError);
      expect(nested).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', reason: 'NESTED_TENANT_TX', retryable: false });
      expect(await caught(runner.probeFreshConnection())).toMatchObject({ reason: 'NESTED_TENANT_TX' });
      return 'outer';
    });
    expect(result).toBe('outer');
    expect(transactions).toHaveLength(1);
    expect(tx.calls).toHaveLength(1);
    expect(isInsideTenantTx()).toBe(false);
  });

  it('AT-US-075-04: the guard spans the async extent of the callback (timers, sibling runners)', async () => {
    const first = setup();
    const second = setup();
    await first.runner.withTenantTx(ctx(), async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(await caught(second.runner.withTenantTx(ctx(), () => Promise.resolve()))).toMatchObject({ reason: 'NESTED_TENANT_TX' });
    });
    expect(second.transactions).toHaveLength(0);
  });

  it.each<[string, Partial<Record<keyof TenantContext, unknown>>]>([
    ['orgId not-a-uuid', { orgId: 'not-a-uuid' }],
    ['orgId with a trailing space', { orgId: `${ORG} ` }],
    ['orgId injection', { orgId: "' OR true --" }],
    ['orgId undefined', { orgId: undefined }],
    ['orgId null', { orgId: null }],
    ['actorId malformed', { actorId: 'x' }],
    ['actorScope ADMIN', { actorScope: 'ADMIN' }],
    ['guestTokenHash uppercase', { guestTokenHash: 'A'.repeat(64) }],
    ['guestTokenHash short', { guestTokenHash: 'a'.repeat(63) }],
    ['guestTokenHash number', { guestTokenHash: 1 }],
    ['correlationId empty', { correlationId: '' }],
    ['correlationId with a newline', { correlationId: 'a\nb' }],
  ])('AT-US-075-02: an invalid context (%s) is refused with INVALID_TENANT_CONTEXT before any database call', async (_label, overrides) => {
    const { runner, transactions } = setup();
    const fn = jest.fn(() => Promise.resolve());
    const error = await caught(runner.withTenantTx(ctx(overrides), fn));
    expect(error).toMatchObject({ status: 500, reason: 'INVALID_TENANT_CONTEXT' });
    expect((error as Error).message).toBe('Database error: INVALID_TENANT_CONTEXT');
    expect(transactions).toHaveLength(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it('AT-US-075-02: a missing context object is refused; empty org and actor (guest/public) are valid', async () => {
    const { runner, tx } = setup();
    expect(await caught(runner.withTenantTx(null as unknown as TenantContext, () => Promise.resolve()))).toMatchObject({
      reason: 'INVALID_TENANT_CONTEXT',
    });
    await runner.withTenantTx(ctx({ orgId: '', actorId: '' }), () => Promise.resolve());
    expect(tx.calls[0]?.values.slice(0, 4)).toEqual(['', '', 'TENANT', '']);
  });
});

describe('in-statement session-leak detector (ADR-0005 am.10 item 16)', () => {
  it.each(['org_id', 'actor_id', 'actor_scope', 'guest_token_hash'])(
    'ADR-0005 am.10 item 16: a prior %s value throws DB_SESSION_CONTEXT_LEAK before fn, emits the event, counts and marks not-ready',
    async (key) => {
      const { runner, deps, events } = setup({ prev: { ...CLEAN, [key]: key === 'actor_scope' ? 'TENANT' : randomUUID() } });
      const fn = jest.fn(() => Promise.resolve());
      const error = await caught(runner.withTenantTx(ctx(), fn));
      expect(error).toBeInstanceOf(DbError);
      expect((error as DbError).toJSON()).toEqual({
        status: 500,
        code: 'INTERNAL_ERROR',
        reason: 'DB_SESSION_CONTEXT_LEAK',
        retryable: false,
        securityEvent: 'db_session_context_leak',
      });
      expect(fn).not.toHaveBeenCalled();
      expect(events).toEqual([['db_session_context_leak', { correlationId: 'req-1' }]]);
      expect(deps.countSessionContextLeak).toHaveBeenCalledTimes(1);
      expect(deps.markNotReady).toHaveBeenCalledWith('db_session_context_leak');
    },
  );

  it("ADR-0005 am.10 item 16: NULL and '' prior values (fresh backend, F-07 reset value) pass", async () => {
    for (const prev of [CLEAN, { org_id: '', actor_id: '', actor_scope: '', guest_token_hash: '' }]) {
      const { runner, deps } = setup({ prev });
      expect(await runner.withTenantTx(ctx(), () => Promise.resolve(42))).toBe(42);
      expect(deps.markNotReady).not.toHaveBeenCalled();
    }
    expect(hasLeakedContext({ org_id: '' })).toBe(false);
    expect(hasLeakedContext(undefined)).toBe(true);
  });

  it('ADR-0005 am.10 item 16: a statement that returns no row is treated as a leak (fail closed)', async () => {
    const { runner, deps } = setup({ prev: undefined });
    expect(await caught(runner.withTenantTx(ctx(), () => Promise.resolve()))).toMatchObject({ reason: 'DB_SESSION_CONTEXT_LEAK' });
    expect(deps.markNotReady).toHaveBeenCalledTimes(1);
  });
});

describe('error mapping inside withTenantTx (ADR-0005 am.10 items 3 and 6)', () => {
  const rlsError = Object.assign(new Error('Invalid raw query: shipments'), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2010',
    meta: {
      driverAdapterError: { cause: { originalCode: '42501', originalMessage: 'new row violates row-level security policy for table "x"' } },
    },
  });

  it('ADR-0005 am.10 item 6: an RLS WITH CHECK rejection from fn maps to 403 AUTHZ_DENIED and emits rls_write_rejected', async () => {
    const { runner, events } = setup();
    const error = await caught(runner.withTenantTx(ctx(), () => Promise.reject(rlsError)));
    expect(error).toMatchObject({ status: 403, code: 'AUTHZ_DENIED', securityEvent: 'rls_write_rejected' });
    expect(events).toEqual([['rls_write_rejected', { correlationId: 'req-1', sqlState: '42501' }]]);
  });

  it('ADR-0005 am.10 item 3: P2028 from $transaction (pool checkout maxWait) maps to a retryable 503', async () => {
    const p2028 = Object.assign(new Error('Unable to start a transaction in the given time.'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2028',
    });
    const { runner, events } = setup({ transactionError: p2028 });
    expect(await caught(runner.withTenantTx(ctx(), () => Promise.resolve()))).toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      retryable: true,
      retryAfterSeconds: 1,
    });
    expect(events).toEqual([]);
  });

  it('[TASK-010 onDbError] the redacting hook receives the ORIGINAL error and its mapping; the caller gets only the DbError', async () => {
    const seen: Array<[unknown, unknown]> = [];
    const fake = fakeClient();
    const { deps } = fakeDeps();
    const runner = createWithTenantTx(fake.client, OPTIONS, {
      ...deps,
      scopeClient: () => fake.client,
      onDbError: (error, mapping) => void seen.push([error, mapping]),
    });
    const error = await caught(runner.withTenantTx(ctx(), () => Promise.reject(rlsError)));
    expect(error).toBeInstanceOf(DbError);
    expect(error).not.toHaveProperty('cause');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe(rlsError);
    expect(seen[0]?.[1]).toMatchObject({ status: 403, code: 'AUTHZ_DENIED', reason: 'RLS_WRITE_REJECTED' });
  });

  it('[TASK-010 onDbError] a throwing hook never masks the mapped error, and non-database errors never reach it', async () => {
    const fake = fakeClient();
    const { deps } = fakeDeps();
    const hook = jest.fn<(error: unknown) => void>(() => {
      throw new Error('logger down');
    });
    const runner = createWithTenantTx(fake.client, OPTIONS, { ...deps, scopeClient: () => fake.client, onDbError: hook });
    expect(await caught(runner.withTenantTx(ctx(), () => Promise.reject(rlsError)))).toMatchObject({ code: 'AUTHZ_DENIED' });
    const domain = new Error('domain rule');
    expect(await caught(runner.withTenantTx(ctx(), () => Promise.reject(domain)))).toBe(domain);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('application errors and DbErrors from fn (e.g. expectAffected) pass through unchanged', async () => {
    const { runner } = setup();
    const domain = new Error('domain rule');
    expect(await caught(runner.withTenantTx(ctx(), () => Promise.reject(domain)))).toBe(domain);
    const notFound = await caught(
      runner.withTenantTx(ctx(), () =>
        Promise.reject(new DbError({ status: 404, code: 'NOT_FOUND', reason: 'NOT_FOUND', retryable: false })),
      ),
    );
    expect(notFound).toMatchObject({ status: 404, reason: 'NOT_FOUND' });
  });
});

describe('factory configuration (ADR-0005 am.10 items 3 and 4)', () => {
  it('ADR-0005 am.10 item 4: refuses to construct when PGOPTIONS is set (injected env or process.env)', () => {
    const { client } = fakeClient();
    const { deps } = fakeDeps();
    for (const value of ['-c search_path=public', '']) {
      expect(() => createWithTenantTx(client, OPTIONS, { ...deps, scopeClient: () => client, env: { PGOPTIONS: value } })).toThrow(
        TenantTxConfigError,
      );
    }
    const withoutEnv = {
      onSecurityEvent: deps.onSecurityEvent,
      countSessionContextLeak: deps.countSessionContextLeak,
      markNotReady: deps.markNotReady,
      scopeClient: () => client,
    };
    const saved = process.env['PGOPTIONS'];
    process.env['PGOPTIONS'] = '-c statement_timeout=0';
    try {
      expect(() => createWithTenantTx(client, OPTIONS, withoutEnv)).toThrow('PGOPTIONS must not be set');
    } finally {
      if (saved === undefined) delete process.env['PGOPTIONS'];
      else process.env['PGOPTIONS'] = saved;
    }
  });

  it.each<[string, Partial<WithTenantTxOptions>, string]>([
    ['maxWait above the pool connection timeout', { maxWaitMs: 5_001 }, 'maxWaitMs must not exceed'],
    ['timeout below the statement timeout', { timeoutMs: 4_999 }, 'timeoutMs must be at least statementTimeoutMs'],
    ['a fractional statement timeout', { statementTimeoutMs: 1.5 }, 'statementTimeoutMs must be a positive integer'],
    ['a zero lock timeout', { lockTimeoutMs: 0 }, 'lockTimeoutMs must be a positive integer'],
    ['a negative idle timeout', { idleInTransactionTimeoutMs: -1 }, 'idleInTransactionTimeoutMs must be a positive integer'],
  ])('ADR-0005 am.10 item 3: rejects %s', (_label, overrides, message) => {
    expect(() => resolveTransactionOptions({ ...OPTIONS, ...overrides })).toThrow(message);
  });

  it('tenantTxOptionsFromConfig maps the DB_TX_* keys, the pool connection timeout and the admission keys', () => {
    const options = tenantTxOptionsFromConfig({
      DB_TX_STATEMENT_TIMEOUT_MS: 5_000,
      DB_TX_LOCK_TIMEOUT_MS: 2_000,
      DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000,
      DB_CONNECTION_TIMEOUT_MS: 5_000,
      DB_POOL_MAX: 10,
      DB_TENANT_MAX_CONCURRENT_TX: 3,
      DB_TENANT_ADMISSION_WAIT_MS: 400,
    });
    expect(options).toEqual({ ...OPTIONS, admission: { maxConcurrentTx: 3, waitMs: 400 } });
    expect(resolveTransactionOptions(options)).toEqual({ maxWait: 2_000, timeout: 5_000 });
    expect(contextValues(ctx(), options).slice(5)).toEqual(['5000', '2000', '15000']);
  });

  it('[R1-m2] [PR38-SEC-05] the config floor of DB_CONNECTION_TIMEOUT_MS is the runner maxWait: the floor builds, one below cannot', () => {
    // Parity: packages/config refuses (exit 78) every value this runner would refuse at boot (exit 1), and no more.
    expect(DB_CONNECTION_TIMEOUT_MS_MIN).toBe(DEFAULT_MAX_WAIT_MS);
    const at = (ms: number): WithTenantTxOptions =>
      tenantTxOptionsFromConfig({
        DB_TX_STATEMENT_TIMEOUT_MS: 5_000,
        DB_TX_LOCK_TIMEOUT_MS: 2_000,
        DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000,
        DB_CONNECTION_TIMEOUT_MS: ms,
        DB_POOL_MAX: 10,
      });
    expect(resolveTransactionOptions(at(DB_CONNECTION_TIMEOUT_MS_MIN))).toEqual({ maxWait: DEFAULT_MAX_WAIT_MS, timeout: 5_000 });
    expect(() => resolveTransactionOptions(at(DB_CONNECTION_TIMEOUT_MS_MIN - 1))).toThrow(TenantTxConfigError);
  });

  it('ADR-0005 am.10 item 8: guestTokenHash is the lowercase hex SHA-256 computed server-side', () => {
    expect(guestTokenHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(guestTokenHash(randomUUID())).toMatch(/^[0-9a-f]{64}$/);
    expect(() => guestTokenHash('')).toThrow(TypeError);
  });
});

describe('fresh-connection probe (ADR-0005 am.10 item 4)', () => {
  it('ADR-0005 am.10 item 4: passes when no app.* setting carries a value', async () => {
    const { runner, rootCalls, deps } = setup({ settings: [] });
    await runner.probeFreshConnection();
    expect(rootCalls).toHaveLength(1);
    expect(rootCalls[0]?.sql).toContain("coalesce(current_setting(k.name, true), '') <> ''");
    expect(rootCalls[0]?.values).toEqual([[...APP_SETTING_NAMES]]);
    expect(deps.markNotReady).not.toHaveBeenCalled();
  });

  it('ADR-0005 am.10 item 4: any app.* value on a fresh connection is a leak: event, counter, not-ready', async () => {
    const { runner, deps, events } = setup({ settings: [APP_SETTING_NAMES[0]] });
    expect(await caught(runner.probeFreshConnection())).toMatchObject({ reason: 'DB_SESSION_CONTEXT_LEAK' });
    expect(events).toEqual([['db_session_context_leak', {}]]);
    expect(deps.countSessionContextLeak).toHaveBeenCalledTimes(1);
    expect(deps.markNotReady).toHaveBeenCalledTimes(1);
    expect(await findSessionContext(fakeClient({ settings: ['app.a', 'app.b'] }).client)).toEqual(['app.a', 'app.b']);
  });
});

describe('withTenantTx per-transaction client scoping (TASK-032; data-model §7.6, ADR-0005 am. 10 item 5)', () => {
  it('opens the transaction on the client scopeClient returns for the validated (lowercased) org and actor, not on the root client', async () => {
    const root = fakeClient();
    const scoped = fakeClient();
    const { deps } = fakeDeps();
    const stamps: unknown[] = [];
    const runner = createWithTenantTx(root.client, OPTIONS, {
      ...deps,
      scopeClient: (stamp) => {
        stamps.push(stamp);
        return scoped.client;
      },
    });
    await runner.withTenantTx(ctx({ orgId: ORG.toUpperCase(), actorId: ACTOR.toUpperCase() }), () => Promise.resolve('ok'));
    expect(stamps).toEqual([{ orgId: ORG, actorId: ACTOR }]);
    expect(root.transactions).toHaveLength(0);
    expect(scoped.transactions).toHaveLength(1);
    expect(scoped.tx.calls).toHaveLength(1);
  });

  it('an anonymous, organisation-less context is stamped with empty strings (the extension maps them; data-model §1.6)', async () => {
    const root = fakeClient();
    const { deps } = fakeDeps();
    const stamps: unknown[] = [];
    const runner = createWithTenantTx(root.client, OPTIONS, {
      ...deps,
      scopeClient: (stamp) => {
        stamps.push(stamp);
        return root.client;
      },
    });
    await runner.withTenantTx(ctx({ orgId: '', actorId: '' }), () => Promise.resolve(1));
    expect(stamps).toEqual([{ orgId: '', actorId: '' }]);
  });

  it('an invalid context is refused before scopeClient runs', async () => {
    const root = fakeClient();
    const { deps } = fakeDeps();
    const scopeClient = jest.fn(() => root.client);
    const runner = createWithTenantTx(root.client, OPTIONS, { ...deps, scopeClient });
    expect(await caught(runner.withTenantTx(ctx({ actorId: 'not-a-uuid' }), () => Promise.resolve(1)))).toMatchObject({
      reason: 'INVALID_TENANT_CONTEXT',
    });
    expect(scopeClient).not.toHaveBeenCalled();
  });
});

describe('[D-ARCH-086] per-tenant admission bulkhead inside withTenantTx (ADR-0007 am.10 item 3)', () => {
  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  /** A client whose transactions park until released, so permits stay held. */
  function parkingClient(options: { readonly transactionError?: Error } = {}) {
    const tx = new FakeTx(CLEAN);
    const gates: Array<() => void> = [];
    let started = 0;
    const client = {
      async $transaction<R>(fn: (inner: FakeTx) => Promise<R>): Promise<R> {
        started += 1;
        await new Promise<void>((resolve) => gates.push(resolve));
        if (options.transactionError !== undefined) throw options.transactionError;
        return fn(tx);
      },
      $queryRaw<T>(): Promise<T> {
        return Promise.resolve([] as T);
      },
    };
    const openAll = (): void => {
      for (const open of gates.splice(0)) open();
    };
    return { client, started: () => started, openAll };
  }

  const admitted = (maxConcurrentTx: number, waitMs: number, extra: Partial<WithTenantTxOptions> = {}): WithTenantTxOptions => ({
    ...OPTIONS,
    ...extra,
    admission: { maxConcurrentTx, waitMs },
  });

  const LIMIT = { status: 503, code: 'SERVICE_UNAVAILABLE', reason: 'TENANT_CONCURRENCY_LIMIT', retryable: true, retryAfterSeconds: 1 };

  it('[D-ARCH-086] a refused admission (queue depth, then wait expiry) never calls $transaction and is the retryable 503', async () => {
    const parking = parkingClient();
    const { deps } = fakeDeps();
    const runner = createWithTenantTx(parking.client, admitted(1, 20), { ...deps, scopeClient: () => parking.client });
    const first = runner.withTenantTx(ctx(), () => Promise.resolve('first'));
    await flush();
    expect(parking.started()).toBe(1);
    // The queue holds 2 × cap waiters; the key is the validated (lowercased) organisation.
    const queued = [
      runner.withTenantTx(ctx({ orgId: ORG.toUpperCase() }), () => Promise.resolve('q1')),
      runner.withTenantTx(ctx(), () => Promise.resolve('q2')),
    ];
    const overflow = await caught(runner.withTenantTx(ctx(), () => Promise.resolve('overflow')));
    expect(overflow).toBeInstanceOf(DbError);
    expect(overflow).toMatchObject(LIMIT);
    expect(runner.admission?.snapshot()).toMatchObject({ rejectedTotal: { wait: 0, depth: 1 }, queued: 2, keys: 1 });
    for (const waiter of queued) expect(await caught(waiter)).toMatchObject(LIMIT);
    expect(parking.started()).toBe(1);
    expect(runner.admission?.snapshot()).toMatchObject({ rejectedTotal: { wait: 2, depth: 1 }, inflight: { tenant: 1 }, queued: 0 });
    parking.openAll();
    await expect(first).resolves.toBe('first');
    expect(runner.admission?.snapshot()).toMatchObject({ inflight: { tenant: 0, anonymous: 0, operator: 0 }, queued: 0, keys: 0 });
  });

  it('[D-ARCH-086] the permit is released when $transaction rejects (mapped error) and when the callback throws', async () => {
    const p2028 = Object.assign(new Error('Unable to start a transaction in the given time.'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2028',
    });
    const failing = parkingClient({ transactionError: p2028 });
    const { deps } = fakeDeps();
    const runner = createWithTenantTx(failing.client, admitted(1, 50), { ...deps, scopeClient: () => failing.client });
    const rejected = runner.withTenantTx(ctx(), () => Promise.resolve('never'));
    // A waiter queued behind it receives the permit by direct hand-off once the failed transaction settles.
    const next = runner.withTenantTx(ctx(), () => Promise.resolve('never'));
    await flush();
    failing.openAll();
    expect(await caught(rejected)).toMatchObject({ status: 503, reason: 'TRANSACTION_UNAVAILABLE' });
    await flush();
    expect(failing.started()).toBe(2);
    failing.openAll();
    expect(await caught(next)).toMatchObject({ reason: 'TRANSACTION_UNAVAILABLE' });
    expect(runner.admission?.snapshot()).toMatchObject({
      inflight: { tenant: 0 },
      queued: 0,
      keys: 0,
      rejectedTotal: { wait: 0, depth: 0 },
    });

    const fake = fakeClient();
    const throwing = createWithTenantTx(fake.client, admitted(1, 50), { ...deps, scopeClient: () => fake.client });
    const domain = new Error('domain rule');
    expect(await caught(throwing.withTenantTx(ctx(), () => Promise.reject(domain)))).toBe(domain);
    expect(throwing.admission?.snapshot()).toMatchObject({ inflight: { tenant: 0 }, keys: 0 });
    await expect(throwing.withTenantTx(ctx(), () => Promise.resolve('committed'))).resolves.toBe('committed');
    expect(throwing.admission?.snapshot()).toMatchObject({ inflight: { tenant: 0 }, keys: 0 });
  });

  it('[D-ARCH-086] the key comes from the validated values: an operator transaction never takes its organisation’s permits', async () => {
    const parking = parkingClient();
    const { deps } = fakeDeps();
    const runner = createWithTenantTx(parking.client, admitted(1, 20), { ...deps, scopeClient: () => parking.client });
    const operator = runner.withTenantTx(ctx({ actorScope: 'OPERATOR' }), () => Promise.resolve('operator'));
    const tenant = runner.withTenantTx(ctx(), () => Promise.resolve('tenant'));
    const anonymous = runner.withTenantTx(ctx({ orgId: '', actorId: '' }), () => Promise.resolve('anonymous'));
    await flush();
    expect(parking.started()).toBe(3);
    expect(runner.admission?.snapshot()).toMatchObject({ inflight: { tenant: 1, anonymous: 1, operator: 1 }, keys: 3 });
    // An invalid context is refused before admission: no key state appears.
    expect(await caught(runner.withTenantTx(ctx({ orgId: 'not-a-uuid' }), () => Promise.resolve(1)))).toMatchObject({
      reason: 'INVALID_TENANT_CONTEXT',
    });
    expect(runner.admission?.snapshot()).toMatchObject({ keys: 3, queued: 0 });
    parking.openAll();
    await expect(Promise.all([operator, tenant, anonymous])).resolves.toEqual(['operator', 'tenant', 'anonymous']);
    expect(runner.admission?.snapshot()).toMatchObject({ keys: 0 });
  });

  it('[D-ARCH-086] without admission options no bulkhead is built (direct-factory seam)', () => {
    const { runner } = setup();
    expect(runner.admission).toBeUndefined();
  });

  it.each<[string, WithTenantTxOptions, string]>([
    ['an admission wait above maxWait', admitted(2, 501, { maxWaitMs: 500 }), 'admission.waitMs must not exceed maxWaitMs'],
    ['an admission wait above the default maxWait', admitted(2, DEFAULT_MAX_WAIT_MS + 1), 'admission.waitMs must not exceed maxWaitMs'],
    ['a zero cap', admitted(0, 250), 'admission.maxConcurrentTx must be a positive integer'],
    ['a fractional wait', admitted(2, 2.5), 'admission.waitMs must be a positive integer'],
  ])('[D-ARCH-086] createWithTenantTx refuses %s with TenantTxConfigError', (_label, options, message) => {
    const { client } = fakeClient();
    const { deps } = fakeDeps();
    const build = () => createWithTenantTx(client, options, { ...deps, scopeClient: () => client });
    expect(build).toThrow(TenantTxConfigError);
    expect(build).toThrow(message);
  });

  it('[D-ARCH-086] an admission wait equal to maxWait builds; resolveAdmissionOptions returns the validated pair', () => {
    const { client } = fakeClient();
    const { deps } = fakeDeps();
    expect(
      createWithTenantTx(client, admitted(2, 500, { maxWaitMs: 500 }), { ...deps, scopeClient: () => client }).admission,
    ).toBeDefined();
    expect(resolveAdmissionOptions({ maxConcurrentTx: 3, waitMs: 250 }, 2_000)).toEqual({ maxConcurrentTx: 3, waitMs: 250 });
  });

  it('[D-ARCH-086] config parity: DB_TENANT_ADMISSION_WAIT_MS_MAX is the runner maxWait; unset keys take the pool-derived defaults', () => {
    expect(DB_TENANT_ADMISSION_WAIT_MS_MAX).toBe(DEFAULT_MAX_WAIT_MS);
    const base = {
      DB_TX_STATEMENT_TIMEOUT_MS: 5_000,
      DB_TX_LOCK_TIMEOUT_MS: 2_000,
      DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000,
      DB_CONNECTION_TIMEOUT_MS: 5_000,
    };
    const atMax = tenantTxOptionsFromConfig({ ...base, DB_POOL_MAX: 10, DB_TENANT_ADMISSION_WAIT_MS: DB_TENANT_ADMISSION_WAIT_MS_MAX });
    const { client } = fakeClient();
    const { deps } = fakeDeps();
    expect(createWithTenantTx(client, atMax, { ...deps, scopeClient: () => client }).admission).toBeDefined();
    expect(tenantTxOptionsFromConfig({ ...base, DB_POOL_MAX: 10 }).admission).toEqual({ maxConcurrentTx: 5, waitMs: 250 });
    expect(tenantTxOptionsFromConfig({ ...base, DB_POOL_MAX: 5 }).admission).toEqual({ maxConcurrentTx: 2, waitMs: 250 });
    expect(tenantTxOptionsFromConfig({ ...base, DB_POOL_MAX: 1 }).admission).toEqual({ maxConcurrentTx: 2, waitMs: 250 });
  });
});

describe('[PR42-SEC-02] rollback-only latch: a swallowed audit refusal never commits the business change', () => {
  const ENTRY: AuditEntryInput = {
    action: 'CREATE',
    outcome: 'SUCCESS',
    entityName: 'address',
    entityId: 'a-1',
    orgId: ORG,
    actor: { type: 'USER', userId: ACTOR },
    origin: { sourceApp: 'web', correlationId: 'corr-0001-latch' },
  };
  const store = (appendBatch: AuditStore['appendBatch']): AuditStore => ({ appendBatch, insertVaultRows: () => Promise.resolve([]) });

  /** The fake client, recording whether each transaction committed (callback resolved) or rolled back (it threw). */
  function recordingSetup() {
    const fake = fakeClient();
    const outcomes: string[] = [];
    const client = {
      ...fake.client,
      async $transaction<R>(fn: (inner: FakeTx) => Promise<R>, txOptions?: { maxWait?: number; timeout?: number }): Promise<R> {
        try {
          const result = await fake.client.$transaction(fn, txOptions);
          outcomes.push('commit');
          return result;
        } catch (error) {
          outcomes.push('rollback');
          throw error;
        }
      },
    };
    const { deps } = fakeDeps();
    const logged: unknown[] = [];
    const runner = createWithTenantTx(client, OPTIONS, {
      ...deps,
      scopeClient: () => client,
      onDbError: (error) => void logged.push(error),
    });
    return { runner, outcomes, logged };
  }

  it('an INVALID_ENTRY refusal raised before any SQL, caught and swallowed by the callback, still rolls back with 500', async () => {
    const { runner, outcomes } = recordingSetup();
    const writer = createAuditWriter({ store: store(() => Promise.reject(new Error('never called'))), lockTimeoutMs: 250 });
    const swallowed: unknown[] = [];
    const error = await caught(
      runner.withTenantTx(ctx(), async (db) => {
        await writer.write(db, { ...ENTRY, outcome: 'OK' as 'SUCCESS' }).catch((refusal: unknown) => void swallowed.push(refusal));
        return 'business change done';
      }),
    );
    expect(swallowed).toEqual([expect.objectContaining({ kind: 'INVALID_ENTRY' })]);
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ status: 500, code: 'AUDIT_WRITE_FAILED', reason: 'AUDIT_WRITE_FAILED' });
    expect(outcomes).toEqual(['rollback']);
  });

  it('a swallowed lock timeout rolls back and answers 503 instead of resolving', async () => {
    const { runner, outcomes } = recordingSetup();
    const timeout = new AuditWriteError('LOCK_TIMEOUT', { sqlState: '55P03' });
    const writer = createAuditWriter({ store: store(() => Promise.reject(timeout)), lockTimeoutMs: 250 });
    const error = await caught(
      runner.withTenantTx(ctx(), async (db) => {
        await writer.write(db, ENTRY).catch(() => undefined);
        return 'ok';
      }),
    );
    expect(error).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', reason: 'AUDIT_LOCK_TIMEOUT', retryable: true });
    expect(outcomes).toEqual(['rollback']);
  });

  it('the first marked failure wins; a later error thrown by the callback itself passes through (and rolls back)', async () => {
    const { runner, outcomes } = recordingSetup();
    const first = new AuditWriteError('HEAD_MOVED');
    const own = new Error('domain rule');
    expect(
      await caught(
        runner.withTenantTx(ctx(), (db) => {
          db.markRollbackOnly(first);
          db.markRollbackOnly(new AuditWriteError('LOCK_TIMEOUT', { sqlState: '55P03' }));
          return Promise.resolve('ok');
        }),
      ),
    ).toMatchObject({ status: 500, code: 'AUDIT_WRITE_FAILED' });
    expect(
      await caught(
        runner.withTenantTx(ctx(), (db) => {
          db.markRollbackOnly(first);
          return Promise.reject(own);
        }),
      ),
    ).toBe(own);
    expect(outcomes).toEqual(['rollback', 'rollback']);
  });

  it('an unmarked transaction commits as before, and the latch is per transaction', async () => {
    const { runner, outcomes } = recordingSetup();
    const writer = createAuditWriter({ store: store(() => Promise.reject(new AuditWriteError('HEAD_MOVED'))), lockTimeoutMs: 250 });
    await caught(runner.withTenantTx(ctx(), async (db) => writer.write(db, ENTRY).then(() => 'never')));
    await expect(runner.withTenantTx(ctx(), () => Promise.resolve('next'))).resolves.toBe('next');
    expect(outcomes).toEqual(['rollback', 'commit']);
  });
});

describe('[PR42-SEC-13] a write the callback starts but does not await never lets the business change commit without its entry', () => {
  const PII_ENTRY: AuditEntryInput = {
    action: 'CREATE',
    outcome: 'SUCCESS',
    entityName: 'address',
    entityId: 'a-2',
    orgId: ORG,
    actor: { type: 'USER', userId: ACTOR },
    origin: { sourceApp: 'web', correlationId: 'corr-0002-detached' },
    newValue: { name: pii({ entityName: 'address', field: 'name', classification: 'PERSONAL', value: 'Asha Rao', subject: null }) },
  };
  const PLAIN_ENTRY: AuditEntryInput = { ...PII_ENTRY, newValue: { city: 'Pune' } };
  const APPENDED: AppendedEntry = { id: 'e-1', streamId: ORG, streamSeq: 1, occurredAt: '', prevHash: '', entryHash: '' };
  const later = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  /** The fake client; `events` records the store's statements and whether the transaction committed or rolled back. */
  function setup() {
    const fake = fakeClient();
    const events: string[] = [];
    const client = {
      ...fake.client,
      async $transaction<R>(fn: (inner: FakeTx) => Promise<R>, txOptions?: { maxWait?: number; timeout?: number }): Promise<R> {
        try {
          const result = await fake.client.$transaction(fn, txOptions);
          events.push('commit');
          return result;
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
    };
    const { deps } = fakeDeps();
    const runner = createWithTenantTx(client, OPTIONS, { ...deps, scopeClient: () => client });
    /** A store whose append issues two statements on the handed transaction, each recorded once it answered. */
    const store: AuditStore = {
      async appendBatch(db) {
        await db.$queryRaw`SELECT 1`;
        events.push('statement 1');
        await db.$executeRaw`SELECT 2`;
        events.push('statement 2');
        return [APPENDED];
      },
      insertVaultRows: () => Promise.resolve([]),
    };
    return { runner, events, store };
  }

  it('L8: `void writer.write(...)` with a 20 ms tokeniser commits only after the entry is appended', async () => {
    const { runner, events, store } = setup();
    const writer = createAuditWriter({
      store,
      lockTimeoutMs: 250,
      tokeniser: {
        tokenise: async (_db, values) => {
          await later(20);
          return values.map(() => randomUUID());
        },
      },
    });
    const result = await runner.withTenantTx(ctx(), (db) => {
      void writer.write(db, PII_ENTRY);
      return Promise.resolve('business change done');
    });
    expect(result).toBe('business change done');
    expect(events).toEqual(['statement 1', 'statement 2', 'commit']);
  });

  it('L8c: a tokeniser failing after the callback returned rolls back with 500 (the `.catch(log)` spelling)', async () => {
    const { runner, events, store } = setup();
    const writer = createAuditWriter({
      store,
      lockTimeoutMs: 250,
      tokeniser: {
        tokenise: async () => {
          await later(20);
          throw new Error('vault down');
        },
      },
    });
    const logged: unknown[] = [];
    const error = await caught(
      runner.withTenantTx(ctx(), (db) => {
        writer.write(db, PII_ENTRY).catch((failure: unknown) => void logged.push(failure));
        return Promise.resolve('business change done');
      }),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ status: 500, code: 'AUDIT_WRITE_FAILED' });
    expect(logged).toEqual([expect.objectContaining({ kind: 'TOKENISER_FAILED' })]);
    expect(events).toEqual(['rollback']);
  });

  it('L8d: no personal values and a store issuing two statements: the append completes before COMMIT (no timer)', async () => {
    const { runner, events, store } = setup();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250 });
    await runner.withTenantTx(ctx(), (db) => {
      void writer.write(db, PLAIN_ENTRY);
      return Promise.resolve('ok');
    });
    expect(events).toEqual(['statement 1', 'statement 2', 'commit']);
  });

  it('L8d: a detached append failing after its first statement rolls back and answers the audit failure', async () => {
    const { runner, events } = setup();
    const failing: AuditStore = {
      async appendBatch(db) {
        await db.$queryRaw`SELECT 1`;
        events.push('statement 1');
        await later(5);
        throw new AuditWriteError('HEAD_MOVED');
      },
      insertVaultRows: () => Promise.resolve([]),
    };
    const writer = createAuditWriter({ store: failing, lockTimeoutMs: 250 });
    const error = await caught(
      runner.withTenantTx(ctx(), (db) => {
        writer.write(db, PLAIN_ENTRY).catch(() => undefined);
        return Promise.resolve('ok');
      }),
    );
    expect(error).toMatchObject({ status: 500, code: 'AUDIT_WRITE_FAILED' });
    expect(events).toEqual(['statement 1', 'rollback']);
  });

  it('L8b (control): a refusal raised before the first await of a detached write rolls back, as before', async () => {
    const { runner, events, store } = setup();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250 });
    const error = await caught(
      runner.withTenantTx(ctx(), (db) => {
        writer.write(db, { ...PII_ENTRY, outcome: 'OK' as 'SUCCESS' }).catch(() => undefined);
        return Promise.resolve('ok');
      }),
    );
    expect(error).toMatchObject({ status: 500, code: 'AUDIT_WRITE_FAILED' });
    expect(events).toEqual(['rollback']);
  });

  it('a write started after the transaction settled is refused (TENANT_TX_CLOSED) and touches nothing', async () => {
    const { runner, events, store } = setup();
    const writer = createAuditWriter({ store, lockTimeoutMs: 250 });
    let kept: TenantDb<FakeTx> | undefined;
    await runner.withTenantTx(ctx(), (db) => {
      kept = db;
      return Promise.resolve('ok');
    });
    await expect(writer.write(kept as TenantDb<FakeTx>, PLAIN_ENTRY)).rejects.toThrow('TENANT_TX_CLOSED');
    expect(events).toEqual(['commit']);
  });
});

describe('[PR42-SEC-17] a write whose START the callback deferred still completes before COMMIT, or the transaction rolls back', () => {
  const ENTRY: AuditEntryInput = {
    action: 'CREATE',
    outcome: 'SUCCESS',
    entityName: 'address',
    entityId: 'a-3',
    orgId: ORG,
    actor: { type: 'USER', userId: ACTOR },
    origin: { sourceApp: 'web', correlationId: 'corr-0003-deferred' },
  };
  const APPENDED: AppendedEntry = { id: 'e-2', streamId: ORG, streamSeq: 1, occurredAt: '', prevHash: '', entryHash: '' };
  const ticks = async (hops: number): Promise<void> => {
    for (let hop = 0; hop < hops; hop += 1) await Promise.resolve();
  };

  /** Like the PR42-SEC-13 setup: `events` records the business statement, the store's append and COMMIT / ROLLBACK. */
  function setup(appendFails = false) {
    const fake = fakeClient();
    const events: string[] = [];
    const client = {
      ...fake.client,
      async $transaction<R>(fn: (inner: FakeTx) => Promise<R>, txOptions?: { maxWait?: number; timeout?: number }): Promise<R> {
        try {
          const result = await fake.client.$transaction(fn, txOptions);
          events.push('commit');
          return result;
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
    };
    const { deps } = fakeDeps();
    const runner = createWithTenantTx(client, OPTIONS, { ...deps, scopeClient: () => client });
    const store: AuditStore = {
      async appendBatch(db) {
        await db.$executeRaw`SELECT 'append'`;
        if (appendFails) throw new AuditWriteError('HEAD_MOVED');
        events.push('entry');
        return [APPENDED];
      },
      insertVaultRows: () => Promise.resolve([]),
    };
    const writer = createAuditWriter({ store, lockTimeoutMs: 250 });
    const business = async (db: TenantDb<FakeTx>): Promise<void> => {
      await db.$executeRaw`SELECT 'slow business'`;
      events.push('business');
    };
    return { runner, events, writer, business };
  }

  it.each([1, 2, 8, 50])('K%i: a write chained %i microtask hops behind the callback commits only with its entry', async (hops) => {
    const { runner, events, writer } = setup();
    await runner.withTenantTx(ctx(), (db) => {
      void ticks(hops).then(() => writer.write(db, ENTRY).catch(() => undefined));
      return Promise.resolve('ok');
    });
    expect(events).toEqual(['entry', 'commit']);
  });

  it('B1: a detached business statement with the write chained after it: business, entry, COMMIT', async () => {
    const { runner, events, writer, business } = setup();
    await runner.withTenantTx(ctx(), (db) => {
      void business(db).then(() => writer.write(db, ENTRY).catch(() => undefined));
      return Promise.resolve('ok');
    });
    expect(events).toEqual(['business', 'entry', 'commit']);
  });

  it('B3: the detached "read the before-image, then write" block commits only together with its entry', async () => {
    const { runner, events, writer } = setup();
    await runner.withTenantTx(ctx(), (db) => {
      void (async () => {
        await db.$executeRaw`SELECT 'slow before image'`;
        await writer.write(db, ENTRY);
      })().catch(() => undefined);
      return Promise.resolve('ok');
    });
    expect(events).toEqual(['entry', 'commit']);
  });

  it('B3 with a failing append: the deferred write marks the latch before COMMIT, so the transaction rolls back (500)', async () => {
    const { runner, events, writer, business } = setup(true);
    const error = await caught(
      runner.withTenantTx(ctx(), (db) => {
        void (async () => {
          await business(db);
          await writer.write(db, ENTRY);
        })().catch(() => undefined);
        return Promise.resolve('ok');
      }),
    );
    expect(error).toMatchObject({ status: 500, code: 'AUDIT_WRITE_FAILED' });
    expect(events).toEqual(['business', 'rollback']);
  });

  it('T0 (documented residual): a write started from a timer runs after COMMIT and is refused (TENANT_TX_CLOSED), never committed', async () => {
    const { runner, events, writer } = setup();
    const late: Promise<unknown>[] = [];
    await runner.withTenantTx(ctx(), (db) => {
      setTimeout(() => void late.push(writer.write(db, ENTRY).catch((failure: unknown) => failure)), 20);
      return Promise.resolve('ok');
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await expect(Promise.all(late)).resolves.toEqual([expect.objectContaining({ reason: 'TENANT_TX_CLOSED' })]);
    // the residual: the transaction committed without the entry; the writer JSDoc forbids timer-started writes and
    // TASK-033's audit-completeness suite is the backstop (PR42-SEC-17 verification: "T0 documented as outside")
    expect(events).toEqual(['commit']);
  });
});

describe('[D-ARCH-122] I3 and the stream check through the real TenantDb and withTenantTx', () => {
  const ENTRY: AuditEntryInput = {
    action: 'UPDATE',
    outcome: 'SUCCESS',
    entityName: 'address',
    entityId: 'a-4',
    orgId: ORG,
    actor: { type: 'USER', userId: ACTOR },
    origin: { sourceApp: 'web', correlationId: 'corr-0004-flush' },
  };

  function setup() {
    const fake = fakeClient();
    const outcomes: string[] = [];
    const client = {
      ...fake.client,
      async $transaction<R>(fn: (inner: FakeTx) => Promise<R>, txOptions?: { maxWait?: number; timeout?: number }): Promise<R> {
        try {
          const result = await fake.client.$transaction(fn, txOptions);
          outcomes.push('commit');
          return result;
        } catch (error) {
          outcomes.push('rollback');
          throw error;
        }
      },
    };
    const { deps } = fakeDeps();
    const runner = createWithTenantTx(client, OPTIONS, { ...deps, scopeClient: () => client });
    const batches: number[] = [];
    const store: AuditStore = {
      appendBatch: (_db, rows) => {
        batches.push(rows.length);
        return Promise.resolve(
          rows.map((row) => ({ id: row.id, streamId: row.streamId, streamSeq: 1, occurredAt: '', prevHash: '', entryHash: '' })),
        );
      },
      insertVaultRows: () => Promise.resolve([]),
    };
    return { runner, outcomes, batches, writer: createAuditWriter({ store, lockTimeoutMs: 250 }) };
  }

  it('[I3] entries recorded but never flushed fail the transaction with 500 AUDIT_WRITE_FAILED and roll it back', async () => {
    const { runner, outcomes, batches, writer } = setup();
    const error = await caught(
      runner.withTenantTx(ctx(), (db) => {
        writer.record(db, ENTRY);
        return Promise.resolve('business change done');
      }),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ status: 500, code: 'AUDIT_WRITE_FAILED', reason: 'AUDIT_WRITE_FAILED' });
    expect(outcomes).toEqual(['rollback']);
    expect(batches).toEqual([]);
  });

  it('two records and one flush commit in one batch; the buffer is per transaction', async () => {
    const { runner, outcomes, batches, writer } = setup();
    for (let run = 0; run < 2; run += 1) {
      await runner.withTenantTx(ctx(), async (db) => {
        writer.record(db, ENTRY);
        writer.record(db, { ...ENTRY, entityId: 'a-5' });
        await writer.flush(db);
        return 'ok';
      });
    }
    expect(batches).toEqual([2, 2]);
    expect(outcomes).toEqual(['commit', 'commit']);
  });

  it('[STREAM_MISMATCH] contextOrgId is the validated organisation of the transaction; an entry of another organisation rolls back', async () => {
    const { runner, outcomes, writer } = setup();
    const other = randomUUID();
    const seen: string[] = [];
    const error = await caught(
      runner.withTenantTx(ctx({ orgId: other.toUpperCase() }), (db) => {
        seen.push(db.contextOrgId());
        try {
          writer.record(db, ENTRY);
        } catch {
          // swallowed on purpose: the latch still rolls the transaction back (PR42-SEC-02)
        }
        return Promise.resolve('ok');
      }),
    );
    expect(seen).toEqual([other]);
    expect(error).toMatchObject({ status: 500, code: 'AUDIT_WRITE_FAILED' });
    expect(outcomes).toEqual(['rollback']);
  });
});
