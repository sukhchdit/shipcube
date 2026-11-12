import { randomUUID } from 'node:crypto';

import { describe, expect, it, jest } from '@jest/globals';

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
  const runner = createWithTenantTx(fake.client, txOptions, deps);
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
    const runner = createWithTenantTx(fake.client, OPTIONS, { ...deps, onDbError: (error, mapping) => void seen.push([error, mapping]) });
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
    const runner = createWithTenantTx(fake.client, OPTIONS, { ...deps, onDbError: hook });
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
      expect(() => createWithTenantTx(client, OPTIONS, { ...deps, env: { PGOPTIONS: value } })).toThrow(TenantTxConfigError);
    }
    const withoutEnv = {
      onSecurityEvent: deps.onSecurityEvent,
      countSessionContextLeak: deps.countSessionContextLeak,
      markNotReady: deps.markNotReady,
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

  it('tenantTxOptionsFromConfig maps the DB_TX_* keys and the pool connection timeout', () => {
    const options = tenantTxOptionsFromConfig({
      DB_TX_STATEMENT_TIMEOUT_MS: 5_000,
      DB_TX_LOCK_TIMEOUT_MS: 2_000,
      DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000,
      DB_CONNECTION_TIMEOUT_MS: 5_000,
    });
    expect(options).toEqual(OPTIONS);
    expect(resolveTransactionOptions(options)).toEqual({ maxWait: 2_000, timeout: 5_000 });
    expect(contextValues(ctx(), options).slice(5)).toEqual(['5000', '2000', '15000']);
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
