import { inspect } from 'node:util';

import { describe, expect, it } from '@jest/globals';

import { DbError } from './map-db-error.js';
import {
  createTenantDb,
  isTemplateStringsArray,
  modelDelegateNames,
  TENANT_DB_OMITTED,
  type TenantDb,
  TenantDbAccessError,
} from './tenant-db.js';

const PRIVATE = Symbol('prisma-private-client');

class FakeDelegate {
  readonly name = 'Shipment';
  get $parent(): unknown {
    return { $queryRawUnsafe: (): string => 'unsafe' };
  }
  findMany(): string {
    return `rows:${this.name}`;
  }
  aggregateRaw(): string {
    return 'mongo-only';
  }
}

class FakeTx {
  readonly #secret = 'internal';
  readonly _runtimeDataModel = { models: { Shipment: {}, LedgerEntry: {} } };
  readonly shipment = new FakeDelegate();
  readonly ledgerEntry = new FakeDelegate();
  readonly _originalClient = { root: true };
  readonly version = 7;
  readonly [PRIVATE] = { $transaction: (): string => 'savepoint' };

  get $parent(): unknown {
    return { $transaction: (): string => 'savepoint' };
  }
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): string {
    return `${this.#secret}:${strings.join('?')}:${String(values.length)}`;
  }
  $executeRaw(strings: TemplateStringsArray): number {
    return strings.length;
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
];

const read = (value: unknown, key: PropertyKey): unknown => (value as Record<PropertyKey, unknown>)[key];
const EXPOSED = ['shipment', 'ledgerEntry', '$queryRaw', '$executeRaw', '$queryRawTyped'];

describe('TenantDb run-time guard (ADR-0005 am.10 item 1; PR #11 M1, PR11-SEC-01)', () => {
  it('ADR-0005 am.10 item 1: $transaction, $queryRawUnsafe and $executeRawUnsafe throw at run time', () => {
    const { db } = createTenantDb(new FakeTx());
    for (const member of TENANT_DB_OMITTED) {
      expect(() => read(db, member)).toThrow(TenantDbAccessError);
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
    expect(Reflect.ownKeys(db.shipment)).toEqual(['findMany']);
    expect(Object.getOwnPropertyDescriptor(db, '$parent')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(db, PRIVATE)).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(db, '$queryRaw')).toMatchObject({ writable: false, configurable: true });
    expect('shipment' in db).toBe(true);
    expect('then' in db).toBe(false);
    expect(Object.keys({ ...db })).toEqual(EXPOSED);
  });

  it('ADR-0005 am.10 item 1: allowed members work and methods run against the raw transaction client and delegate', () => {
    const { db } = createTenantDb(new FakeTx());
    expect(db.$queryRaw`SELECT ${1}`).toBe('internal:SELECT ?:1');
    expect(db.$executeRaw`SELECT 1`).toBe(1);
    expect(db.$queryRawTyped({ sql: 'typed' })).toBe('internal:typed');
    expect(db.shipment.findMany()).toBe('rows:Shipment');
    expect(db.$queryRaw).toBe(db.$queryRaw);
    expect(db.shipment).toBe(db.shipment);
  });

  it('PR #11 m5: $queryRaw/$executeRaw refuse a non-tagged call (a Sql object, a plain string, a forged array, no argument)', () => {
    const { db } = createTenantDb(new FakeTx());
    const query = read(db, '$queryRaw') as (...args: unknown[]) => unknown;
    const execute = read(db, '$executeRaw') as (...args: unknown[]) => unknown;
    const sqlObject = { strings: ['SELECT 1'], values: [], sql: 'SELECT 1' };
    const forged = Object.assign(['SELECT 1'], { raw: ['SELECT 1'] });
    for (const args of [[sqlObject], ['SELECT 1'], [forged], []]) {
      expect(() => query(...args)).toThrow(new TenantDbAccessError('$queryRaw called without a tagged template'));
      expect(() => execute(...args)).toThrow(new TenantDbAccessError('$executeRaw called without a tagged template'));
    }
  });

  it('PR #11 m5: isTemplateStringsArray accepts only the tagged-template shape', () => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]): TemplateStringsArray => (values.length >= 0 ? strings : strings);
    expect(isTemplateStringsArray(tag`a${1}b`)).toBe(true);
    expect(isTemplateStringsArray(['a'])).toBe(false);
    expect(isTemplateStringsArray(Object.freeze(Object.assign(['a', 'b'], { raw: ['a'] })))).toBe(false);
    expect(isTemplateStringsArray('a')).toBe(false);
  });

  it('PR11-SEC-01: model names come from the runtime data model and fail closed without one', () => {
    expect([...modelDelegateNames(new FakeTx())]).toEqual(['shipment', 'ledgerEntry']);
    expect([...modelDelegateNames({ shipment: new FakeDelegate() })]).toEqual([]);
    expect([...modelDelegateNames({ _runtimeDataModel: { models: null } })]).toEqual([]);
    const { db } = createTenantDb({ shipment: new FakeDelegate(), $queryRaw: (): number => 1 });
    expect(() => read(db, 'shipment')).toThrow(new TenantDbAccessError('shipment'));
    expect(Reflect.ownKeys(db)).toEqual(['$queryRaw']);
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
