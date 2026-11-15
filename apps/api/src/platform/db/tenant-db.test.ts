import { inspect } from 'node:util';

import { describe, expect, it } from '@jest/globals';

import { DbError } from './map-db-error.js';
import {
  createTenantDb,
  FLUENT_HINT,
  isSqlFragment,
  isTemplateStringsArray,
  modelDelegateNames,
  TENANT_DB_LATCH_MEMBERS,
  TENANT_DB_OMITTED,
  TENANT_DB_RAW_MEMBERS,
  TENANT_DB_RESULT_LABEL,
  type TenantDb,
  TenantDbAccessError,
} from './tenant-db.js';

const PRIVATE = Symbol('prisma-private-client');

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * A stand-in for Prisma's `PrismaPromise`: lazy (the query "runs" when `then` is called, logged in `started`), with
 * the members the guard must hide: `requestTransaction` (re-runs on a caller-chosen transaction), `spec` and a fluent
 * relation accessor.
 */
class FakePrismaPromise {
  readonly spec = { action: 'findFirst' };
  constructor(
    private readonly started: string[],
    private readonly label: string,
    private readonly outcome: () => unknown,
  ) {}
  requestTransaction(): string {
    this.started.push(`ROOT:${this.label}`);
    return 'root';
  }
  author(): string {
    return 'fluent';
  }
  then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown): Promise<unknown> {
    this.started.push(this.label);
    return Promise.resolve().then(this.outcome).then(onFulfilled, onRejected);
  }
  // `catch` / `finally` complete the PrismaPromise type; the guard derives both from `then`, so they never run here.
  catch(onRejected?: (reason: unknown) => unknown): Promise<unknown> {
    return this.then(undefined, onRejected);
  }
  finally(onFinally?: () => void): Promise<unknown> {
    return this.then().finally(onFinally);
  }
}

class FakeDelegate {
  readonly name = 'Shipment';
  constructor(readonly started: string[] = []) {}
  get $parent(): unknown {
    return { $queryRawUnsafe: (): string => 'unsafe' };
  }
  findMany(): string {
    return `rows:${this.name}`;
  }
  findFirst(): FakePrismaPromise {
    return new FakePrismaPromise(this.started, 'findFirst', () => ({ id: 1 }));
  }
  findUnique(): FakePrismaPromise {
    return new FakePrismaPromise(this.started, 'findUnique', () => {
      throw new Error('boom');
    });
  }
  count(): () => number {
    return countFn;
  }
  delete(): null {
    return null;
  }
  create(): object {
    return createdRow;
  }
  aggregateRaw(): string {
    return 'mongo-only';
  }
}

const countFn = (): number => 3;
const createdRow = { id: 2 };

class FakeTx {
  readonly #secret = 'internal';
  readonly started: string[] = [];
  readonly _runtimeDataModel = { models: { Shipment: {}, LedgerEntry: {} } };
  readonly shipment = new FakeDelegate(this.started);
  readonly ledgerEntry = new FakeDelegate(this.started);
  readonly _originalClient = { root: true };
  readonly version = 7;
  readonly [PRIVATE] = { $transaction: (): string => 'savepoint' };

  get $parent(): unknown {
    return { $transaction: (): string => 'savepoint' };
  }
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): string {
    return `${this.#secret}:${strings.join('?')}:${String(values.length)}`;
  }
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): FakePrismaPromise {
    return new FakePrismaPromise(this.started, '$executeRaw', () => strings.length + values.length);
  }
  $queryRawTyped(query: { sql: string }): string {
    return `${this.#secret}:${query.sql}`;
  }
  $transaction(): string {
    return 'savepoint';
  }
  $queryRawUnsafe(): string {
    return 'unsafe';
  }
  $executeRawUnsafe(): string {
    return 'unsafe';
  }
  $extends(): string {
    return 'extended';
  }
}

type Assert<T extends true> = T;
type Lacks<T, K extends PropertyKey> = K extends keyof T ? false : true;
// Compile-time half of ADR-0005 am.10 item 1: the omitted members are not part of the type.
export type TenantDbOmitsMembers = [
  Assert<Lacks<TenantDb<FakeTx>, '$transaction'>>,
  Assert<Lacks<TenantDb<FakeTx>, '$queryRawUnsafe'>>,
  Assert<Lacks<TenantDb<FakeTx>, '$executeRawUnsafe'>>,
  Assert<Lacks<TenantDb<FakeTx>, '$queryRawTyped'>>,
];

const read = (value: unknown, key: PropertyKey): unknown => (value as Record<PropertyKey, unknown>)[key];
/** The guard-provided latch members (PR42-SEC-02, PR42-SEC-13) are the only non-Prisma members, always last. */
const EXPOSED = ['shipment', 'ledgerEntry', '$queryRaw', '$executeRaw', 'markRollbackOnly', 'track'];
const RESULT_KEYS = ['then', 'catch', 'finally', Symbol.toStringTag];
const CLOSED = 'Database error: TENANT_TX_CLOSED';
/** The settled outcome of a thenable: `ok:<value>` or the rejection's message. */
const settled = async (value: unknown): Promise<string> => {
  try {
    return `ok:${JSON.stringify(await (value as PromiseLike<unknown>))}`;
  } catch (error) {
    return (error as Error).message;
  }
};

describe('TenantDb run-time guard (ADR-0005 am.10 item 1; PR #11 M1, PR11-SEC-01)', () => {
  it('ADR-0005 am.10 item 1, PR11-SEC-15 f: $transaction, the *Unsafe members and $queryRawTyped throw at run time', () => {
    const { db } = createTenantDb(new FakeTx());
    expect(TENANT_DB_OMITTED).toContain('$queryRawTyped');
    expect(TENANT_DB_RAW_MEMBERS).toEqual(['$queryRaw', '$executeRaw']);
    for (const member of TENANT_DB_OMITTED) {
      expect(() => read(db, member)).toThrow(new TenantDbAccessError(member));
      expect(member in db).toBe(false);
    }
  });

  it.each(['$parent', 'constructor', '__proto__', '$extends', '$connect', '$on', '_originalClient', '_engine', 'version', 'toJSON'])(
    'PR11-SEC-01: deny by default at the top level: %s throws and is not reported by `in`',
    (member) => {
      const { db } = createTenantDb(new FakeTx());
      expect(() => read(db, member)).toThrow(new TenantDbAccessError(member));
      expect(member in db).toBe(false);
    },
  );

  it.each(['$parent', 'constructor', 'name', '_model', 'aggregateRaw', '__proto__'])(
    'PR11-SEC-01: model delegates are guarded too: shipment.%s throws',
    (member) => {
      const { db } = createTenantDb(new FakeTx());
      expect(() => read(db.shipment, member)).toThrow(new TenantDbAccessError(member));
    },
  );

  it('PR11-SEC-01: symbol keys: the private client symbol reads undefined; toStringTag is the label and inspect shows no internals', () => {
    const { db } = createTenantDb(new FakeTx());
    expect(read(db, PRIVATE)).toBeUndefined();
    expect(read(db, Symbol.iterator)).toBeUndefined();
    expect(Object.getOwnPropertySymbols(db)).toEqual([]);
    expect(Object.prototype.toString.call(db)).toBe('[object TenantDb]');
    expect(inspect(db)).toBe('[Object: null prototype] {}');
    expect(inspect(db.shipment)).toBe('[Object: null prototype] {}');
    expect(Object.getPrototypeOf(db)).toBeNull();
  });

  it('PR11-SEC-01: ownKeys, getOwnPropertyDescriptor and has reveal only the exposed members', () => {
    const { db } = createTenantDb(new FakeTx());
    expect(Reflect.ownKeys(db)).toEqual(EXPOSED);
    expect(Reflect.ownKeys(db.shipment)).toEqual(['findUnique', 'findFirst', 'findMany', 'create', 'delete', 'count']);
    expect(Object.getOwnPropertyDescriptor(db, '$parent')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(db, PRIVATE)).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(db, '$queryRaw')).toMatchObject({ writable: false, configurable: true });
    expect('shipment' in db).toBe(true);
    expect('then' in db).toBe(false);
    expect(Object.keys({ ...db })).toEqual(EXPOSED);
  });

  it('ADR-0005 am.10 item 1: allowed members work and methods run against the raw transaction client and delegate', async () => {
    const { db } = createTenantDb(new FakeTx());
    expect(db.$queryRaw`SELECT ${1}`).toBe('internal:SELECT ?:1');
    expect(await db.$executeRaw`SELECT 1`).toBe(1);
    expect(db.shipment.findMany()).toBe('rows:Shipment');
    expect(db.$queryRaw).toBe(db.$queryRaw);
    expect(db.shipment).toBe(db.shipment);
  });

  it('R2-M1 / PR11-SEC-12: non-thenable results (a primitive, null, a function, a plain object) pass through unchanged', () => {
    const { db } = createTenantDb(new FakeTx());
    expect(db.shipment.findMany()).toBe('rows:Shipment');
    expect(db.shipment.delete()).toBeNull();
    expect(db.shipment.count()).toBe(countFn);
    expect(db.shipment.create()).toBe(createdRow);
  });

  it('[PR #32 n2] serialiser and matcher probe keys read as undefined on a pending result, so printing it cannot throw', () => {
    const { db } = createTenantDb(new FakeTx());
    const result = db.shipment.findFirst();
    for (const member of ['toJSON', '$$typeof', 'asymmetricMatch', 'nodeType']) {
      expect(read(result, member)).toBeUndefined();
      expect(member in result).toBe(false);
    }
    expect(() => JSON.stringify({ pending: result })).not.toThrow();
    expect(Reflect.ownKeys(result)).toEqual(RESULT_KEYS);
  });

  it('R2-M1 / PR11-SEC-12: a thenable result exposes only then/catch/finally and its label (no requestTransaction, spec or fluent accessor)', () => {
    const tx = new FakeTx();
    const { db } = createTenantDb(tx);
    for (const result of [db.shipment.findFirst(), db.$executeRaw`SELECT 1`]) {
      expect(Reflect.ownKeys(result)).toEqual(RESULT_KEYS);
      for (const member of ['requestTransaction', 'spec', 'author', '_createPrismaPromise', 'constructor']) {
        expect(member in result).toBe(false);
        // [R3-n4] a read fails loudly (no fluent accessor reads as undefined and is then called on a wrong guess).
        expect(() => read(result, member)).toThrow(new TenantDbAccessError(member, FLUENT_HINT));
      }
      expect(FLUENT_HINT).toBe('fluent accessors are not exposed; use include/select');
      expect(read(result, Symbol.iterator)).toBeUndefined();
      expect(typeof read(result, 'then')).toBe('function');
      expect(inspect(result)).toContain('TenantDbResult');
      expect(Object.getPrototypeOf(result)).toBeNull();
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.prototype.toString.call(result)).toBe(`[object ${TENANT_DB_RESULT_LABEL}]`);
      expect(TENANT_DB_RESULT_LABEL).toBe('TenantDbResult');
    }
    expect(tx.started).toEqual([]);
  });

  it('R2-M1 / PR11-SEC-12: the result is lazy, runs its query once and then/catch/finally delegate to it while open', async () => {
    const tx = new FakeTx();
    const { db } = createTenantDb(tx);
    const found = db.shipment.findFirst();
    const failing = db.shipment.findUnique();
    expect(tx.started).toEqual([]);
    expect(await found).toEqual({ id: 1 });
    expect(await found.then((row) => JSON.stringify(row))).toBe('{"id":1}');
    expect(tx.started).toEqual(['findFirst']);
    expect(await failing.catch((error: unknown) => (error as Error).message)).toBe('boom');
    let cleaned = 0;
    expect(await settled(failing.finally(() => (cleaned += 1)))).toBe('boom');
    expect(cleaned).toBe(1);
    expect(tx.started).toEqual(['findFirst', 'findUnique']);
    const thenReturn: unknown = found.then();
    expect(thenReturn).toBeInstanceOf(Promise);
    expect('requestTransaction' in (thenReturn as object)).toBe(false);
  });

  it('R2-M1 / PR11-SEC-12: after revoke then/catch/finally reject with TENANT_TX_CLOSED without starting the query', async () => {
    const tx = new FakeTx();
    const handle = createTenantDb(tx);
    const kept = handle.db.shipment.findFirst();
    const keptRaw = handle.db.$executeRaw`SELECT 2`;
    const ran = handle.db.shipment.findFirst();
    expect(await ran).toEqual({ id: 1 });
    handle.revoke();
    expect(await settled(kept)).toBe(CLOSED);
    expect(await settled(keptRaw)).toBe(CLOSED);
    expect(await kept.catch((error: unknown) => (error as DbError).message)).toBe(CLOSED);
    let cleaned = 0;
    expect(await settled(kept.finally(() => (cleaned += 1)))).toBe(CLOSED);
    expect(cleaned).toBe(1);
    expect(await settled(ran)).toBe(CLOSED);
    expect(await kept.then(undefined, (error: unknown) => error instanceof DbError)).toBe(true);
    expect(tx.started).toEqual(['findFirst']);
  });

  it('PR #11 m5: $queryRaw/$executeRaw refuse a non-tagged call (a Sql object, a plain string, a forged array, no argument)', () => {
    const { db } = createTenantDb(new FakeTx());
    const query = read(db, '$queryRaw') as (...args: unknown[]) => unknown;
    const execute = read(db, '$executeRaw') as (...args: unknown[]) => unknown;
    const sqlObject = { strings: ['SELECT 1'], values: [], sql: 'SELECT 1' };
    const forged = Object.assign(['SELECT 1'], { raw: ['SELECT 1'] });
    const frozenWithLooseRaw = Object.freeze(Object.assign(['SELECT 1'], { raw: ['SELECT 1'] }));
    for (const args of [[sqlObject], ['SELECT 1'], [forged], [frozenWithLooseRaw], []]) {
      expect(() => query(...args)).toThrow(new TenantDbAccessError('$queryRaw called without a tagged template'));
      expect(() => execute(...args)).toThrow(new TenantDbAccessError('$executeRaw called without a tagged template'));
    }
  });

  it('R2-n3: isTemplateStringsArray accepts only the tagged-template shape (array and raw both frozen, equal length)', () => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]): TemplateStringsArray => (values.length >= 0 ? strings : strings);
    expect(isTemplateStringsArray(tag`a${1}b`)).toBe(true);
    expect(isTemplateStringsArray(['a'])).toBe(false);
    expect(isTemplateStringsArray(Object.freeze(Object.assign(['a', 'b'], { raw: Object.freeze(['a']) })))).toBe(false);
    expect(isTemplateStringsArray(Object.freeze(Object.assign(['a'], { raw: ['a'] })))).toBe(false);
    expect(isTemplateStringsArray(Object.freeze(Object.assign(['a'], { raw: 'a' })))).toBe(false);
    expect(isTemplateStringsArray('a')).toBe(false);
    // The stated limit: a deliberate forge with both arrays frozen passes (lint and review are the control).
    expect(isTemplateStringsArray(Object.freeze(Object.assign(['a'], { raw: Object.freeze(['a']) })))).toBe(true);
  });

  it('PR11-SEC-13: isSqlFragment recognises Sql-shaped values and the Sql class, and nothing else', () => {
    class Sql {
      readonly strings: string[] = ['x'];
      readonly values: unknown[] = [];
    }
    class _Sql {}
    const bare = Object.create(Sql.prototype) as object;
    expect([new Sql(), new _Sql(), bare, { strings: ['x'], values: [] }].map(isSqlFragment)).toEqual([true, true, true, true]);
    const notFragments = [
      null,
      undefined,
      'raw text',
      7,
      ['a'],
      new Date(0),
      { strings: ['x'] },
      { values: [] },
      Object.create(null) as object,
      Object.create({ constructor: 1 }) as object,
      new Uint8Array(2),
      (): number => 1,
    ];
    expect(notFragments.map(isSqlFragment)).toEqual(notFragments.map(() => false));
  });

  it('[PR11-SEC-17] [R3-n2] isSqlFragment: `in` checks (not Array.isArray) and the whole prototype chain', () => {
    class _Sql {}
    class Deeper extends class extends _Sql {} {}
    // R3-n2 forge: an intermediate prototype with its own constructor used to hide Sql.prototype one level up.
    const forged = Object.create(Object.create(_Sql.prototype, { constructor: { value: Object } }) as object) as object;
    const withGetters = Object.create({
      get strings(): string {
        return 'not an array';
      },
      get values(): number {
        return 0;
      },
    }) as object;
    const arrayShaped = Object.assign(['x'], { strings: 'x', values: 'y' });
    const fnShaped = Object.assign((): number => 1, { strings: 1, values: 2 });
    let deep: object = Object.create(null) as object;
    for (let level = 0; level < 40; level += 1) deep = Object.create(deep) as object;
    const shapes = [new Deeper(), forged, { strings: 'x', values: [] }, withGetters, arrayShaped, fnShaped, deep];
    expect(shapes.map(isSqlFragment)).toEqual(shapes.map(() => true));
  });

  it('PR11-SEC-13: a Sql fragment interpolated as a VALUE of a tagged $queryRaw/$executeRaw is refused before Prisma runs', () => {
    const tx = new FakeTx();
    const { db } = createTenantDb(tx);
    class Sql {
      readonly strings = ["1' OR 1=1 --"];
      readonly values: unknown[] = [];
    }
    const fragment = { strings: ['x'], values: [] };
    expect(() => db.$queryRaw`SELECT ${1}, ${new Sql()}`).toThrow(new TenantDbAccessError('$queryRaw with an interpolated Sql fragment'));
    expect(() => db.$executeRaw`SELECT ${fragment}`).toThrow(new TenantDbAccessError('$executeRaw with an interpolated Sql fragment'));
    expect(db.$queryRaw`SELECT ${[1, 2]}::int[], ${new Date(0)}, ${null}`).toBe('internal:SELECT ?::int[], ?, ?:3');
    expect(tx.started).toEqual([]);
  });

  it('[PR44-SEC-05] a transaction-control, session, DO or unreadable statement is refused before Prisma is called', () => {
    const sent: string[] = [];
    class RecordingTx extends FakeTx {
      override $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): string {
        sent.push(strings.join('?'));
        return super.$queryRaw(strings, ...values);
      }
    }
    const tx = new RecordingTx();
    const { db } = createTenantDb(tx);
    const refused = (statement: () => unknown, message: string): void => {
      expect(statement).toThrow(new TenantDbAccessError(message));
    };
    refused(() => db.$queryRaw`COMMIT`, '$queryRaw with a transaction-control statement (COMMIT)');
    refused(() => db.$queryRaw`SELECT ${1}; rollback`, '$queryRaw with a transaction-control statement (ROLLBACK)');
    refused(() => db.$executeRaw`SET search_path TO elsewhere`, '$executeRaw with a session statement (SET)');
    refused(() => db.$queryRaw`RESET ALL`, '$queryRaw with a session statement (RESET)');
    // Code review R1-n4 (PR #54): the TenantDb guard has no read-only allowance (only withTenantTx sends it, D-TASK020-80).
    refused(() => db.$executeRaw`SET TRANSACTION READ ONLY`, '$executeRaw with a session statement (SET)');
    // PR54-SEC-01 / -02 (a): a CR-ended comment, a held cursor and a session advisory lock.
    refused(() => db.$executeRaw`SELECT 1 -- x\r; COMMIT`, '$executeRaw with a transaction-control statement (COMMIT)');
    refused(() => db.$executeRaw`DECLARE c CURSOR WITH HOLD FOR SELECT ${1}`, '$executeRaw with a session statement (DECLARE)');
    refused(() => db.$queryRaw`SELECT pg_advisory_lock(${1})`, '$queryRaw with a session statement (a session advisory lock)');
    refused(() => db.$queryRaw`DO $$ BEGIN NULL; END $$`, '$queryRaw with a anonymous-block statement (DO)');
    refused(
      () => db.$queryRaw`UPDATE pg_settings SET setting = ${'x'} WHERE name = ${'y'}`,
      '$queryRaw with a session-setter statement (UPDATE pg_settings)',
    );
    // A tagged template part without a cooked value (an invalid escape) cannot be read: refused (fail closed).
    const uncooked = Object.freeze(Object.assign([undefined], { raw: Object.freeze(['x']) }));
    refused(
      () => (db.$queryRaw as (...args: unknown[]) => unknown)(uncooked),
      '$queryRaw with a unreadable statement (a template part with an invalid escape)',
    );
    expect(sent).toEqual([]);
    expect(tx.started).toEqual([]);
    // Ordinary statements still reach Prisma, keywords inside strings, quoted names and comments included.
    expect(db.$queryRaw`SELECT 'COMMIT' AS "end" -- ROLLBACK`).toBe(`internal:SELECT 'COMMIT' AS "end" -- ROLLBACK:0`);
    expect(sent).toEqual([`SELECT 'COMMIT' AS "end" -- ROLLBACK`]);
  });

  it('PR11-SEC-01: model names come from the runtime data model and fail closed without one', () => {
    expect([...modelDelegateNames(new FakeTx())]).toEqual(['shipment', 'ledgerEntry']);
    expect([...modelDelegateNames({ shipment: new FakeDelegate() })]).toEqual([]);
    expect([...modelDelegateNames({ _runtimeDataModel: { models: null } })]).toEqual([]);
    const { db } = createTenantDb({ shipment: new FakeDelegate(), $queryRaw: (): number => 1 });
    expect(() => read(db, 'shipment')).toThrow(new TenantDbAccessError('shipment'));
    expect(Reflect.ownKeys(db)).toEqual(['$queryRaw', 'markRollbackOnly', 'track']);
    // A data-model name whose property is not an object is refused (fail closed).
    const ghost = createTenantDb({ _runtimeDataModel: { models: { Ghost: {} } }, ghost: 5 }).db;
    expect(() => read(ghost, 'ghost')).toThrow(new TenantDbAccessError('ghost'));
  });

  it('ADR-0005 am.10 item 1: a non-function model member (Prisma `fields`) is returned as is', () => {
    const fields = { id: 'field-ref' };
    const { db } = createTenantDb({ _runtimeDataModel: { models: { Shipment: {} } }, shipment: { fields } });
    expect(read(db.shipment, 'fields')).toBe(fields);
  });

  it('ADR-0005 am.10 item 1: the guard is read-only at both levels', () => {
    const { db } = createTenantDb(new FakeTx());
    const record = db as unknown as Record<string, unknown>;
    expect(() => {
      record['$queryRaw'] = (): string => 'replaced';
    }).toThrow(TenantDbAccessError);
    expect(() => Object.defineProperty(db, 'x', { value: 1 })).toThrow(TenantDbAccessError);
    expect(() => delete record['shipment']).toThrow(TenantDbAccessError);
    expect(() => {
      Object.setPrototypeOf(db, {});
    }).toThrow(TenantDbAccessError);
    expect(() => Object.freeze(db)).toThrow(TenantDbAccessError);
    expect(() => Reflect.set(db, Symbol.for('x'), 1)).toThrow(new TenantDbAccessError('Symbol(x)'));
    const shipment = db.shipment as unknown as Record<string, unknown>;
    expect(() => {
      shipment['findMany'] = (): string => 'replaced';
    }).toThrow(TenantDbAccessError);
  });

  it('ADR-0005 am.10 item 1: the handle is not a thenable, so an async callback may return it', async () => {
    const { db } = createTenantDb(new FakeTx());
    expect(read(db, 'then')).toBeUndefined();
    expect(read(db.shipment, 'then')).toBeUndefined();
    await expect(Promise.resolve(db)).resolves.toBe(db);
  });

  it('PR42-SEC-02: markRollbackOnly latches the first failure, is not a Prisma member and closes with the transaction', () => {
    const tx = new FakeTx();
    const handle = createTenantDb(tx);
    expect(handle.rollbackOnly()).toBeUndefined();
    expect('markRollbackOnly' in tx).toBe(false);
    const mark = handle.db.markRollbackOnly;
    const first = new Error('first');
    mark(first);
    handle.db.markRollbackOnly(new Error('second'));
    expect(handle.rollbackOnly()).toBe(first);
    expect(Object.getOwnPropertyDescriptor(handle.db, 'markRollbackOnly')).toMatchObject({ writable: false, enumerable: true });
    expect(() => {
      (handle.db as unknown as Record<string, unknown>)['markRollbackOnly'] = (): void => undefined;
    }).toThrow(TenantDbAccessError);
    handle.revoke();
    expect(() => mark(new Error('late'))).toThrow(CLOSED);
    expect(() => handle.db.markRollbackOnly).toThrow(CLOSED);
    expect(handle.rollbackOnly()).toBe(first);
  });

  it('PR42-SEC-13: track starts the work, returns its own promise, is not a Prisma member and settle awaits it', async () => {
    const tx = new FakeTx();
    const handle = createTenantDb(tx);
    expect('track' in tx).toBe(false);
    expect(TENANT_DB_LATCH_MEMBERS).toEqual(['markRollbackOnly', 'track']);
    expect(Object.getOwnPropertyDescriptor(handle.db, 'track')).toMatchObject({ writable: false, enumerable: true });
    expect(() => {
      (handle.db as unknown as Record<string, unknown>)['track'] = (): void => undefined;
    }).toThrow(TenantDbAccessError);
    const order: string[] = [];
    const release = deferred();
    let started = false;
    const work = handle.db.track(async () => {
      started = true;
      await release.promise;
      order.push('work done');
      return 7;
    });
    expect(started).toBe(true);
    const settling = handle.settle().then(() => order.push('settled'));
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([]);
    release.resolve();
    await settling;
    expect(order).toEqual(['work done', 'settled']);
    await expect(work).resolves.toBe(7);
    // Nothing in flight: settle resolves at once, and again after a failed work (settle never rejects).
    await expect(handle.settle()).resolves.toBeUndefined();
    const failing = handle.db.track(() => Promise.reject(new Error('tracked failure')));
    await expect(handle.settle()).resolves.toBeUndefined();
    await expect(failing).rejects.toThrow('tracked failure');
  });

  it('PR42-SEC-13: settle also awaits work a tracked work starts later, and work started while settling', async () => {
    const handle = createTenantDb(new FakeTx());
    const done: string[] = [];
    const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
    void handle.db.track(async () => {
      await tick();
      done.push('outer');
      void handle.db.track(async () => {
        await tick();
        await tick();
        done.push('inner');
      });
    });
    await handle.settle();
    expect(done).toEqual(['outer', 'inner']);
  });

  it('PR42-SEC-13: track refuses after revoke without starting the work, and a non-function or a synchronous throw', () => {
    const handle = createTenantDb(new FakeTx());
    const track = handle.db.track;
    expect(() => (track as (work: unknown) => unknown)(Promise.resolve(1))).toThrow(TypeError);
    expect(() =>
      track(() => {
        throw new Error('sync');
      }),
    ).toThrow('sync');
    handle.revoke();
    let started = false;
    expect(() =>
      track(() => {
        started = true;
        return Promise.resolve(1);
      }),
    ).toThrow(CLOSED);
    expect(started).toBe(false);
    expect(() => handle.db.track).toThrow(CLOSED);
  });

  it('PR42-SEC-02: a non-Error passed by an untyped caller still latches (as a TypeError)', () => {
    const handle = createTenantDb(new FakeTx());
    (handle.db.markRollbackOnly as (failure: unknown) => void)('not an error');
    expect(handle.rollbackOnly()).toBeInstanceOf(TypeError);
  });

  it('PR11-SEC-01: after revoke every access, through the top level or a kept delegate reference, throws TENANT_TX_CLOSED', () => {
    const handle = createTenantDb(new FakeTx());
    const shipment = handle.db.shipment;
    const query = handle.db.$queryRaw;
    const findMany = read(shipment, 'findMany') as () => unknown;
    handle.revoke();
    expect(() => query`SELECT 1`).toThrow('Database error: TENANT_TX_CLOSED');
    expect(() => findMany()).toThrow('Database error: TENANT_TX_CLOSED');
    expect(() => handle.db.$queryRaw).toThrow(DbError);
    expect(() => handle.db.shipment).toThrow('Database error: TENANT_TX_CLOSED');
    expect(() => shipment.findMany).toThrow('Database error: TENANT_TX_CLOSED');
    expect(() => Reflect.ownKeys(shipment)).toThrow('Database error: TENANT_TX_CLOSED');
    expect(() => 'findMany' in shipment).toThrow('Database error: TENANT_TX_CLOSED');
    expect(read(handle.db, 'then')).toBeUndefined();
    expect(inspect(shipment)).toBe('[Object: null prototype] {}');
    expect(typeof query).toBe('function');
  });
});
